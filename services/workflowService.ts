import crypto from 'crypto';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { getIO } from '../sockets/socketServer.js';
import { generateRawCompletion, sanitizeAiInput } from './aiService.js';
import { createTeam, addTeamMember } from './teamService.js';
import { createScopedMeeting } from './meetingService.js';
import { addCollaborator, checkDocumentAccess } from './documentService.js';
import { MeetingScopeType, NotificationType, OrgRole, DocumentScopeType } from '@prisma/client';
import { WorkflowStep, workflowStepSchema } from '../validators/workflowValidators.js';

interface StoredWorkflowPlan {
  planId: string;
  userId: string;
  organizationId?: string;
  summary: string;
  steps: WorkflowStep[];
  createdAt: string;
  isExecuted?: boolean;
}

const inMemoryPlans = new Map<string, { data: StoredWorkflowPlan; expiresAt: number }>();
const inMemoryExecutingPlans = new Set<string>();
const inMemoryExecutedPlans = new Set<string>();
const inMemoryPlanCheckpoints = new Map<string, {
  results: Array<{
    step: number;
    action: string;
    description?: string;
    success: boolean;
    resource?: any;
    error?: string;
  }>;
  variables: Record<string, string>;
}>();

const savePlan = async (plan: StoredWorkflowPlan): Promise<void> => {
  const serialized = JSON.stringify(plan);
  inMemoryPlans.set(plan.planId, {
    data: plan,
    expiresAt: Date.now() + 900 * 1000,
  });
  try {
    await redis.set(`workflow:plan:${plan.planId}`, serialized, 'EX', 900);
  } catch (err) {
    logger.warn('Failed to cache workflow plan in Redis, falling back to memory', err);
  }
};

const getPlan = async (planId: string): Promise<StoredWorkflowPlan | null> => {
  if (inMemoryExecutedPlans.has(planId)) {
    return null;
  }
  try {
    const isExecuted = await redis.get(`workflow:plan:executed:${planId}`);
    if (isExecuted) {
      return null;
    }
  } catch (err) {
    logger.warn('Failed to check executed status in Redis', err);
  }

  try {
    const raw = await redis.get(`workflow:plan:${planId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.isExecuted) {
        return null;
      }
      return parsed;
    }
  } catch (err) {
    logger.warn('Failed to read workflow plan from Redis, checking memory fallback', err);
  }

  const mem = inMemoryPlans.get(planId);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.data;
  }
  return null;
};

const getUserOrganizationContext = async (userId: string, targetOrgId?: string) => {
  if (!targetOrgId) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true },
      take: 2,
    });
    const ownedOrgs = await prisma.organization.findMany({
      where: { ownerId: userId },
      select: { id: true },
      take: 2,
    });
    const distinctOrgIds = new Set([
      ...memberships.map((m) => m.organizationId),
      ...ownedOrgs.map((o) => o.id),
    ]);

    if (distinctOrgIds.size > 1) {
      return null;
    }
    if (distinctOrgIds.size === 1) {
      targetOrgId = Array.from(distinctOrgIds)[0];
    } else {
      return null;
    }
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId, organizationId: targetOrgId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          owner: {
            select: { id: true, name: true, email: true },
          },
          members: {
            select: {
              role: true,
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
          teams: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (membership?.organization) {
    const org = membership.organization;
    const membersList = org.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role as string,
    }));
    if (org.owner && !membersList.some((m) => m.id === org.owner.id)) {
      membersList.unshift({
        id: org.owner.id,
        name: org.owner.name,
        email: org.owner.email,
        role: 'OWNER',
      });
    }

    return {
      organizationId: org.id,
      organizationName: org.name,
      userRole: membership.role,
      isOwner: org.ownerId === userId,
      availableMembers: membersList,
      availableTeams: org.teams.map((t) => ({
        id: t.id,
        name: t.name,
      })),
    };
  }

  const ownedOrg = await prisma.organization.findFirst({
    where: { id: targetOrgId, ownerId: userId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      owner: {
        select: { id: true, name: true, email: true },
      },
      members: {
        select: {
          role: true,
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      teams: {
        select: { id: true, name: true },
      },
    },
  });

  if (ownedOrg) {
    const membersList = ownedOrg.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role as string,
    }));
    if (ownedOrg.owner && !membersList.some((m) => m.id === ownedOrg.owner.id)) {
      membersList.unshift({
        id: ownedOrg.owner.id,
        name: ownedOrg.owner.name,
        email: ownedOrg.owner.email,
        role: 'OWNER',
      });
    }

    return {
      organizationId: ownedOrg.id,
      organizationName: ownedOrg.name,
      userRole: OrgRole.ORG_ADMIN,
      isOwner: true,
      availableMembers: membersList,
      availableTeams: ownedOrg.teams.map((t) => ({
        id: t.id,
        name: t.name,
      })),
    };
  }

  return null;
};

const getUserAccessibleDocuments = async (userId: string, organizationId?: string) => {
  const userTeamMemberships = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const userTeamIds = userTeamMemberships.map((tm) => tm.teamId);

  let isOrgAdminOrOwner = false;
  if (organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerId: true },
    });
    if (org?.ownerId === userId) {
      isOrgAdminOrOwner = true;
    } else {
      const orgMember = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
        select: { role: true },
      });
      if (orgMember?.role === OrgRole.ORG_ADMIN) {
        isOrgAdminOrOwner = true;
      }
    }
  }

  const orgCondition = organizationId
    ? (isOrgAdminOrOwner
        ? { organizationId }
        : {
            organizationId,
            scopeType: { notIn: [DocumentScopeType.TEAM, DocumentScopeType.PROJECT] },
            teamId: null,
            projectId: null,
          })
    : null;

  const userProjectMemberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });
  const userProjectIds = userProjectMemberships.map((pm) => pm.projectId);

  const teamCondition = userTeamIds.length > 0
    ? (organizationId
        ? { organizationId, teamId: { in: userTeamIds } }
        : { teamId: { in: userTeamIds } })
    : null;

  const projectCondition = userProjectIds.length > 0
    ? (organizationId
        ? { organizationId, projectId: { in: userProjectIds } }
        : { projectId: { in: userProjectIds } })
    : null;

  const docs = await prisma.document.findMany({
    where: {
      OR: [
        { createdById: userId, ...(organizationId ? { organizationId } : {}) },
        { collaborators: { some: { userId } }, ...(organizationId ? { organizationId } : {}) },
        ...(orgCondition ? [orgCondition] : []),
        ...(teamCondition ? [teamCondition] : []),
        ...(projectCondition ? [projectCondition] : []),
      ],
      isArchived: false,
    },
    select: {
      id: true,
      title: true,
      scopeType: true,
    },
    take: 50,
  });

  return docs;
};

export const generateWorkflowPlan = async (
  userId: string,
  rawPrompt: string,
  organizationId?: string,
  autoExecute: boolean = false
) => {
  const sanitizedPrompt = sanitizeAiInput(rawPrompt);
  const orgContext = await getUserOrganizationContext(userId, organizationId);
  if (organizationId && !orgContext) {
    throw new ApiError(403, 'You do not have access to the specified organization');
  }
  const accessibleDocs = await getUserAccessibleDocuments(userId, orgContext?.organizationId);

  const contextData = {
    organization: orgContext
      ? { id: orgContext.organizationId, name: orgContext.organizationName }
      : null,
    members: (orgContext?.availableMembers || []).map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
    })),
    teams: orgContext?.availableTeams || [],
    documents: accessibleDocs.map((d) => ({
      id: d.id,
      title: d.title,
    })),
  };

  const systemInstruction = `You are Quorum's secure workflow orchestration engine.
Your objective is to translate a user's natural language command into an ordered, executable JSON plan of discrete workplace actions.

CRITICAL SECURITY & PRIVACY RULES:
1. Never include internal API endpoints, URLs (like /api/...), system file paths, database schemas, tokens, or credentials in any output field.
2. Only use the following allowed actions:
   - "CREATE_TEAM"
   - "SCHEDULE_MEETING"
   - "SHARE_DOCUMENT"
   - "NOTIFY_MEMBERS"
3. For entity resolution, match names and email addresses mentioned in the prompt to the provided workspace members and documents. If a member or document cannot be matched with certainty, omit or use best matched ID from the provided context.
4. When an action relies on a resource produced in a previous step, reference it using variable syntax:
   - "$step1.teamId" or "$step1.id" for team created in step 1
   - "$step2.meetingId" or "$step2.meetingCode" for meeting created in step 2
5. Parameter requirements per action:
   - "CREATE_TEAM": { "name": string, "description"?: string, "memberIds": string[] }
   - "SCHEDULE_MEETING": { "title": string, "startTime": string (ISO 8601), "durationMinutes"?: number, "teamId"?: string }
   - "SHARE_DOCUMENT": { "documentId": string, "teamId"?: string, "memberIds"?: string[] }
   - "NOTIFY_MEMBERS": { "userIds": string[], "title": string, "message": string }

Output strictly valid JSON with this exact schema:
{
  "summary": "Concise natural language summary of what will be performed",
  "steps": [
    {
      "step": 1,
      "action": "CREATE_TEAM",
      "description": "User-friendly description of this action",
      "params": { ... }
    }
  ]
}`;

  const prompt = `Workspace Context:
${JSON.stringify(contextData, null, 2)}

User Instruction:
"${sanitizedPrompt}"

Generate the JSON execution plan:`;

  const aiResult = await generateRawCompletion(prompt, systemInstruction);
  let parsedPlan: { summary: string; steps: WorkflowStep[] };

  try {
    const cleanedText = aiResult.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsedPlan = JSON.parse(cleanedText);
  } catch (err) {
    logger.error('Failed to parse AI workflow plan JSON', { response: aiResult.text });
    throw new ApiError(502, 'Failed to generate a valid workflow plan from instruction');
  }

  if (!parsedPlan.summary || !Array.isArray(parsedPlan.steps) || parsedPlan.steps.length === 0) {
    throw new ApiError(400, 'Could not determine actionable workflow steps from the instruction');
  }

  const sanitizedSteps: WorkflowStep[] = [];
  const stepNumberMap = new Map<number, number>();
  const seenOriginalSteps = new Set<number>();

  for (let i = 0; i < parsedPlan.steps.length; i++) {
    const rawStep = parsedPlan.steps[i];
    if (!rawStep || typeof rawStep !== 'object') {
      continue;
    }

    const originalStep = typeof (rawStep as any).step === 'number' ? (rawStep as any).step : i + 1;
    if (seenOriginalSteps.has(originalStep)) {
      continue;
    }
    seenOriginalSteps.add(originalStep);

    const parseResult = workflowStepSchema.safeParse({
      step: originalStep,
      action: (rawStep as any).action,
      params: (rawStep as any).params && typeof (rawStep as any).params === 'object' ? (rawStep as any).params : {},
      description: typeof (rawStep as any).description === 'string' ? (rawStep as any).description : undefined,
    });

    if (parseResult.success) {
      const newStepNumber = sanitizedSteps.length + 1;
      stepNumberMap.set(originalStep, newStepNumber);
      sanitizedSteps.push({
        ...parseResult.data,
        step: newStepNumber,
        description: parseResult.data.description || parseResult.data.action.replace('_', ' ').toLowerCase(),
      });
    }
  }

  const remapStepVariables = (val: any): any => {
    if (typeof val === 'string') {
      return val.replace(/\$step(\d+)\b/g, (match, oldNumStr) => {
        const oldNum = parseInt(oldNumStr, 10);
        const newNum = stepNumberMap.get(oldNum);
        return newNum !== undefined ? `$step${newNum}` : match;
      });
    }
    if (Array.isArray(val)) {
      return val.map(remapStepVariables);
    }
    if (val !== null && typeof val === 'object') {
      const res: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        res[k] = remapStepVariables(v);
      }
      return res;
    }
    return val;
  };

  for (const step of sanitizedSteps) {
    step.params = remapStepVariables(step.params);
  }

  if (sanitizedSteps.length === 0) {
    throw new ApiError(400, 'No supported or valid workflow actions found in the prompt');
  }

  const planId = 'wf_plan_' + crypto.randomBytes(6).toString('hex');
  const storedPlan: StoredWorkflowPlan = {
    planId,
    userId,
    organizationId: orgContext?.organizationId,
    summary: parsedPlan.summary,
    steps: sanitizedSteps,
    createdAt: new Date().toISOString(),
  };

  await savePlan(storedPlan);

  if (autoExecute) {
    return await executeWorkflowPlan(userId, planId);
  }

  return {
    planId,
    summary: storedPlan.summary,
    steps: storedPlan.steps,
    requiresConfirmation: true,
  };
};

const resolveVariables = (value: any, variables: Map<string, string>): any => {
  if (typeof value === 'string') {
    if (value.startsWith('$')) {
      if (variables.has(value)) {
        return variables.get(value);
      }
      if (/^\$step\d+(\.|$)/i.test(value)) {
        throw new ApiError(400, `Unresolved workflow variable: ${value}`);
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveVariables(item, variables));
  }
  if (value !== null && typeof value === 'object') {
    const resolvedObj: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      resolvedObj[k] = resolveVariables(v, variables);
    }
    return resolvedObj;
  }
  return value;
};

export const executeWorkflowPlan = async (userId: string, planId: string) => {
  const plan = await getPlan(planId);
  if (!plan) {
    throw new ApiError(404, 'Workflow plan not found or has expired');
  }

  if (plan.userId !== userId) {
    throw new ApiError(403, 'Not authorized to execute this workflow plan');
  }

  const lockKey = `workflow:lock:${planId}`;
  const lockToken = `${userId}:${planId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  let lockAcquiredInRedis = false;
  let lockRenewalTimer: NodeJS.Timeout | null = null;
  try {
    const lockAcquired = await redis.set(lockKey, lockToken, 'EX', 120, 'NX');
    if (!lockAcquired) {
      throw new ApiError(409, 'Workflow plan is currently executing or has already been executed');
    }
    lockAcquiredInRedis = true;
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }

  if (inMemoryExecutingPlans.has(planId)) {
    throw new ApiError(409, 'Workflow plan is currently executing or has already been executed');
  }
  inMemoryExecutingPlans.add(planId);

  if (lockAcquiredInRedis) {
    lockRenewalTimer = setInterval(async () => {
      try {
        const current = await redis.get(lockKey);
        if (current === lockToken) {
          await redis.expire(lockKey, 120);
        } else if (lockRenewalTimer) {
          clearInterval(lockRenewalTimer);
          lockRenewalTimer = null;
        }
      } catch {}
    }, 30000);
  }

  try {
    const variables = new Map<string, string>();
    let results: Array<{
      step: number;
      action: string;
      description?: string;
      success: boolean;
      resource?: any;
      error?: string;
    }> = [];

    try {
      const savedCheckpoint = await redis.get(`workflow:plan:checkpoint:${planId}`);
      if (savedCheckpoint) {
        const parsed = JSON.parse(savedCheckpoint);
        if (Array.isArray(parsed.results)) {
          results = parsed.results;
        }
        if (parsed.variables && typeof parsed.variables === 'object') {
          for (const [k, v] of Object.entries(parsed.variables)) {
            variables.set(k, String(v));
          }
        }
      }
    } catch (chkErr) {
      logger.warn('Failed to read workflow checkpoint from Redis', chkErr);
    }

    if (results.length === 0) {
      const memChk = inMemoryPlanCheckpoints.get(planId);
      if (memChk) {
        results = [...memChk.results];
        for (const [k, v] of Object.entries(memChk.variables)) {
          variables.set(k, String(v));
        }
      }
    }

    let orgId = plan.organizationId;
    if (!orgId) {
      const userOrg = await getUserOrganizationContext(userId);
      orgId = userOrg?.organizationId;
    }

    for (const step of plan.steps) {
      const existingSuccess = results.find((r) => r.step === step.step && r.success);
      if (existingSuccess) {
        continue;
      }
      results = results.filter((r) => r.step !== step.step);

      try {
        const resolvedParams = resolveVariables(step.params, variables);
        if (step.action === 'CREATE_TEAM') {
          if (!orgId) {
            throw new ApiError(400, 'An active organization is required to create a team');
          }

          const callerOrg = await getUserOrganizationContext(userId, orgId);
          if (!callerOrg) {
            throw new ApiError(403, 'You are not a member of this organization');
          }

          const callerRole = callerOrg.userRole;
          const canCreateTeam = callerOrg.isOwner || callerRole === OrgRole.ORG_ADMIN || callerRole === OrgRole.TEAM_HEAD;
          if (!canCreateTeam) {
            throw new ApiError(403, 'Only organization owners, admins, or team heads can create teams');
          }

          const teamName = String(resolvedParams.name || 'New Team').trim();
          const teamDesc = resolvedParams.description ? String(resolvedParams.description).trim() : undefined;

          const team = await createTeam(orgId, userId, {
            name: teamName,
            description: teamDesc,
          });

          variables.set(`$step${step.step}.teamId`, team.id);
          variables.set(`$step${step.step}.id`, team.id);
          variables.set(`$step${step.step}.name`, team.name);

          const memberIds = Array.isArray(resolvedParams.memberIds) ? resolvedParams.memberIds : [];
          let addedCount = 1;
          const failedMemberIds: string[] = [];
          for (const targetId of memberIds) {
            if (targetId && targetId !== userId) {
              try {
                await addTeamMember(orgId, team.id, userId, callerRole, targetId, 'member');
                addedCount++;
              } catch (memberErr) {
                failedMemberIds.push(targetId);
                logger.warn(`Could not add member ${targetId} to team ${team.id}:`, memberErr);
              }
            }
          }

          const hasMemberFailures = failedMemberIds.length > 0;
          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: !hasMemberFailures,
            ...(hasMemberFailures ? { error: `Failed to add member(s): ${failedMemberIds.join(', ')}` } : {}),
            resource: {
              teamId: team.id,
              name: team.name,
              memberCount: addedCount,
              ...(failedMemberIds.length > 0 ? { failedMemberIds } : {}),
            },
          });
        } else if (step.action === 'SCHEDULE_MEETING') {
          if (!resolvedParams.startTime) {
            throw new ApiError(400, 'Meeting startTime is required');
          }
          const startTime = new Date(resolvedParams.startTime);
          if (isNaN(startTime.getTime())) {
            throw new ApiError(400, 'Invalid meeting startTime format');
          }
          if (startTime.getTime() < Date.now() - 60000) {
            throw new ApiError(400, 'Meeting startTime cannot be in the past');
          }

          const meetingTitle = String(resolvedParams.title || 'Team Meeting').trim();
          const targetTeamId = resolvedParams.teamId ? String(resolvedParams.teamId) : undefined;
          const durationMinutes = resolvedParams.durationMinutes !== undefined && resolvedParams.durationMinutes !== null
            ? Number(resolvedParams.durationMinutes)
            : undefined;

          if (durationMinutes !== undefined && (isNaN(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440)) {
            throw new ApiError(400, 'durationMinutes must be a positive number between 1 and 1440');
          }

          const meeting = await createScopedMeeting(userId, {
            title: meetingTitle,
            scopeType: targetTeamId ? MeetingScopeType.TEAM : (orgId ? MeetingScopeType.ORGANIZATION : MeetingScopeType.PERSONAL),
            organizationId: orgId,
            teamId: targetTeamId,
            scheduledStartTime: startTime,
            durationMinutes,
          });

          variables.set(`$step${step.step}.meetingCode`, meeting.code);
          variables.set(`$step${step.step}.meetingId`, meeting.id);
          variables.set(`$step${step.step}.id`, meeting.id);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              meetingId: meeting.id,
              meetingCode: meeting.code,
              title: meeting.title,
              scheduledStartTime: meeting.scheduledStartTime,
              durationMinutes: durationMinutes || 60,
              link: meeting.link,
            },
          });
        } else if (step.action === 'SHARE_DOCUMENT') {
          const documentId = String(resolvedParams.documentId || '').trim();
          if (!documentId) {
            throw new ApiError(400, 'Document ID is required to share document');
          }

          const { doc } = await checkDocumentAccess(userId, documentId, 'EDIT');

          let addedCollaboratorCount = 0;
          const failedCollaboratorIds: string[] = [];

          const targetTeamId = resolvedParams.teamId ? String(resolvedParams.teamId).trim() : undefined;
          let targetTeamOrgId: string | undefined;
          if (targetTeamId) {
            const team = await prisma.team.findUnique({
              where: { id: targetTeamId },
              select: {
                id: true,
                organizationId: true,
                organization: {
                  select: { ownerId: true },
                },
              },
            });

            if (!team) {
              throw new ApiError(404, 'Target team not found');
            }
            targetTeamOrgId = team.organizationId;

            if (orgId && team.organizationId !== orgId) {
              throw new ApiError(403, 'Target team does not belong to the active organization');
            }

            if (doc.organizationId && doc.organizationId !== team.organizationId) {
              throw new ApiError(403, 'Document does not belong to the target team organization');
            }

            const isOwner = team.organization?.ownerId === userId;
            const userOrgMembership = await prisma.organizationMember.findUnique({
              where: {
                organizationId_userId: {
                  organizationId: team.organizationId,
                  userId,
                },
              },
            });

            if (!isOwner && !userOrgMembership) {
              throw new ApiError(403, 'You do not belong to the target team organization');
            }

            const isOrgAdminOrOwner =
              isOwner ||
              userOrgMembership?.role === OrgRole.ORG_ADMIN;

            if (!isOrgAdminOrOwner) {
              const teamMember = await prisma.teamMember.findFirst({
                where: { teamId: targetTeamId, userId },
              });
              if (!teamMember) {
                throw new ApiError(403, 'You are not a member of the target team');
              }
            }

            if (!doc.teamId) {
              await prisma.document.update({
                where: { id: doc.id },
                data: {
                  teamId: targetTeamId,
                  organizationId: team.organizationId,
                  scopeType: 'TEAM',
                },
              });
              doc.teamId = targetTeamId;
              doc.organizationId = team.organizationId;
            } else if (doc.teamId !== targetTeamId) {
              const targetTeamMembers = await prisma.teamMember.findMany({
                where: { teamId: targetTeamId },
                select: { userId: true },
              });
              for (const tm of targetTeamMembers) {
                if (tm.userId !== userId) {
                  try {
                    await addCollaborator(userId, doc.id, {
                      userId: tm.userId,
                      permission: 'VIEW',
                    });
                    addedCollaboratorCount++;
                  } catch (collabErr) {
                    failedCollaboratorIds.push(tm.userId);
                    logger.warn(`Could not add team member ${tm.userId} as collaborator:`, collabErr);
                  }
                }
              }
            }
          }

          const memberIds = Array.isArray(resolvedParams.memberIds) ? resolvedParams.memberIds : [];
          const docOrgId = doc.organizationId || targetTeamOrgId || orgId;
          let allowedOrgMembers = new Set<string>();
          if (docOrgId) {
            const orgMembers = await prisma.organizationMember.findMany({
              where: {
                organizationId: docOrgId,
                userId: { in: memberIds },
              },
              select: { userId: true },
            });
            const org = await prisma.organization.findUnique({
              where: { id: docOrgId },
              select: { ownerId: true },
            });
            allowedOrgMembers = new Set(orgMembers.map((m) => m.userId));
            if (org?.ownerId) {
              allowedOrgMembers.add(org.ownerId);
            }
          }

          for (const targetId of memberIds) {
            if (targetId && targetId !== userId && !failedCollaboratorIds.includes(targetId)) {
              if (docOrgId && !allowedOrgMembers.has(targetId)) {
                failedCollaboratorIds.push(targetId);
                logger.warn(`Cannot add collaborator ${targetId}: user does not belong to document organization ${docOrgId}`);
                continue;
              }
              try {
                await addCollaborator(userId, doc.id, {
                  userId: targetId,
                  permission: 'VIEW',
                });
                addedCollaboratorCount++;
              } catch (collabErr) {
                failedCollaboratorIds.push(targetId);
                logger.warn(`Could not add collaborator ${targetId} to doc ${doc.id}:`, collabErr);
              }
            }
          }

          const requestedMembers = memberIds.filter((id: string) => id && id !== userId);
          if (requestedMembers.length > 0 && addedCollaboratorCount === 0 && !targetTeamId) {
            throw new ApiError(400, 'Failed to add any of the requested collaborators to the document');
          }

          const hasCollabFailures = failedCollaboratorIds.length > 0;

          variables.set(`$step${step.step}.documentId`, doc.id);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: !hasCollabFailures,
            ...(hasCollabFailures ? { error: `Failed to add collaborator(s): ${failedCollaboratorIds.join(', ')}` } : {}),
            resource: {
              documentId: doc.id,
              title: doc.title,
              sharedWithTeam: !!targetTeamId,
              collaboratorCount: addedCollaboratorCount,
              ...(failedCollaboratorIds.length > 0 ? { failedCollaborators: failedCollaboratorIds } : {}),
            },
          });
        } else if (step.action === 'NOTIFY_MEMBERS') {
          const userIds = Array.isArray(resolvedParams.userIds) ? resolvedParams.userIds : [];
          const notifTitle = String(resolvedParams.title || 'Workflow Update').trim();
          const notifMessage = String(resolvedParams.message || 'A new workflow action was completed.').trim();

          if (userIds.length === 0) {
            throw new ApiError(400, 'At least one recipient user ID is required to send notifications');
          }

          let validRecipients: { id: string }[] = [];
          if (orgId) {
            const callerOrg = await getUserOrganizationContext(userId, orgId);
            if (!callerOrg) {
              throw new ApiError(403, 'You are not a member of the target organization');
            }

            const org = await prisma.organization.findUnique({
              where: { id: orgId },
              select: { ownerId: true },
            });

            const orgMembers = await prisma.organizationMember.findMany({
              where: {
                organizationId: orgId,
                userId: { in: userIds },
              },
              select: { userId: true },
            });

            const recipientSet = new Set(orgMembers.map((m) => m.userId));
            if (org?.ownerId && userIds.includes(org.ownerId)) {
              recipientSet.add(org.ownerId);
            }
            validRecipients = Array.from(recipientSet).map((id) => ({ id }));
          } else {
            const senderOrgMemberships = await prisma.organizationMember.findMany({
              where: { userId },
              select: { organizationId: true },
            });
            const senderOwnedOrgs = await prisma.organization.findMany({
              where: { ownerId: userId },
              select: { id: true },
            });
            const senderOrgIds = Array.from(new Set([
              ...senderOrgMemberships.map((m) => m.organizationId),
              ...senderOwnedOrgs.map((o) => o.id),
            ]));

            if (senderOrgIds.length === 0) {
              throw new ApiError(403, 'An active organization context is required to send notifications');
            }

            const sharedOrgMembers = await prisma.organizationMember.findMany({
              where: {
                organizationId: { in: senderOrgIds },
                userId: { in: userIds },
              },
              select: { userId: true },
            });
            const sharedOrgOwners = await prisma.organization.findMany({
              where: {
                id: { in: senderOrgIds },
                ownerId: { in: userIds },
              },
              select: { ownerId: true },
            });

            const recipientSet = new Set([
              ...sharedOrgMembers.map((m) => m.userId),
              ...sharedOrgOwners.map((o) => o.ownerId),
            ]);
            validRecipients = Array.from(recipientSet).map((id) => ({ id }));
          }

          if (validRecipients.length === 0) {
            throw new ApiError(400, 'None of the requested recipients belong to the organization or are valid users');
          }

          for (const u of validRecipients) {
            await prisma.notification.create({
              data: {
                recipientId: u.id,
                actorId: userId,
                type: NotificationType.SYSTEM,
                title: notifTitle,
                body: notifMessage,
                data: { planId },
              },
            });

            try {
              getIO().to(`user:${u.id}`).emit('notification:new', {
                title: notifTitle,
                body: notifMessage,
              });
            } catch (socketErr) {
              logger.warn('Failed to emit live notification to user ' + u.id, socketErr);
            }
          }

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              recipientsCount: validRecipients.length,
            },
          });
        }
      } catch (err: any) {
        logger.error(`Error executing workflow step ${step.step} (${step.action})`, err);
        results.push({
          step: step.step,
          action: step.action,
          description: step.description,
          success: false,
          error: err?.message || 'Action failed during execution',
        });
      }

      const checkpointData = {
        results,
        variables: Object.fromEntries(variables.entries()),
      };
      inMemoryPlanCheckpoints.set(planId, checkpointData);
      try {
        await redis.set(`workflow:plan:checkpoint:${planId}`, JSON.stringify(checkpointData), 'EX', 900);
      } catch (saveChkErr) {
        logger.warn('Failed to save workflow checkpoint in Redis', saveChkErr);
      }
    }

    results.sort((a, b) => a.step - b.step);

    const hasFailures = results.some((r) => !r.success);
    const allFailed = results.length > 0 && results.every((r) => !r.success);
    const finalStatus = allFailed ? 'FAILED' : hasFailures ? 'PARTIALLY_COMPLETED' : 'COMPLETED';

    try {
      getIO().to(`user:${userId}`).emit('workflow:completed', {
        planId,
        status: finalStatus,
        results,
      });
    } catch (ioErr) {
      logger.warn('Failed to emit workflow:completed socket event', ioErr);
    }

    if (hasFailures) {
      if (allFailed) {
        inMemoryPlanCheckpoints.delete(planId);
        try {
          await redis.del(`workflow:plan:checkpoint:${planId}`);
        } catch {}
      }
    } else {
      inMemoryPlanCheckpoints.delete(planId);
      inMemoryExecutedPlans.add(planId);
      inMemoryPlans.delete(planId);

      try {
        await redis.del(`workflow:plan:checkpoint:${planId}`);
      } catch {}

      try {
        await redis.set(`workflow:plan:executed:${planId}`, '1', 'EX', 1800);
        await redis.del(`workflow:plan:${planId}`);
      } catch (delErr) {
        logger.warn('Failed to delete workflow plan from Redis, overwriting as consumed', delErr);
        try {
          await redis.set(`workflow:plan:${planId}`, JSON.stringify({ ...plan, isExecuted: true }), 'EX', 60);
        } catch {}
      }
    }

    return {
      planId,
      summary: plan.summary,
      status: finalStatus,
      executedAt: new Date(),
      results,
    };
  } finally {
    if (lockRenewalTimer) {
      clearInterval(lockRenewalTimer);
      lockRenewalTimer = null;
    }
    inMemoryExecutingPlans.delete(planId);
    if (lockAcquiredInRedis) {
      try {
        const currentLock = await redis.get(lockKey);
        if (currentLock === lockToken) {
          await redis.del(lockKey);
        }
      } catch {}
    }
  }
};
