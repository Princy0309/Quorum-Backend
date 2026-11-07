import crypto from 'crypto';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { getIO } from '../sockets/socketServer.js';
import { generateRawCompletion, sanitizeAiInput } from './aiService.js';
import { createTeam, addTeamMember } from './teamService.js';
import { createScopedMeeting } from './meetingService.js';
import { addCollaborator } from './documentService.js';
import { MeetingScopeType, NotificationType, OrgRole } from '@prisma/client';
import { WorkflowStep } from '../validators/workflowValidators.js';

interface StoredWorkflowPlan {
  planId: string;
  userId: string;
  organizationId?: string;
  summary: string;
  steps: WorkflowStep[];
  createdAt: string;
}

const inMemoryPlans = new Map<string, { data: StoredWorkflowPlan; expiresAt: number }>();

const savePlan = async (plan: StoredWorkflowPlan): Promise<void> => {
  const serialized = JSON.stringify(plan);
  try {
    await redis.set(`workflow:plan:${plan.planId}`, serialized, 'EX', 900);
  } catch (err) {
    logger.warn('Failed to cache workflow plan in Redis, falling back to memory', err);
    inMemoryPlans.set(plan.planId, {
      data: plan,
      expiresAt: Date.now() + 900 * 1000,
    });
  }
};

const getPlan = async (planId: string): Promise<StoredWorkflowPlan | null> => {
  try {
    const raw = await redis.get(`workflow:plan:${planId}`);
    if (raw) {
      return JSON.parse(raw);
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

const getUserOrganizationContext = async (userId: string) => {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          ownerId: true,
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
    return {
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      userRole: membership.role,
      isOwner: membership.organization.ownerId === userId,
      availableMembers: membership.organization.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      })),
      availableTeams: membership.organization.teams.map((t) => ({
        id: t.id,
        name: t.name,
      })),
    };
  }

  const ownedOrg = await prisma.organization.findFirst({
    where: { ownerId: userId },
    select: {
      id: true,
      name: true,
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
    return {
      organizationId: ownedOrg.id,
      organizationName: ownedOrg.name,
      userRole: OrgRole.ORG_ADMIN,
      isOwner: true,
      availableMembers: ownedOrg.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      })),
      availableTeams: ownedOrg.teams.map((t) => ({
        id: t.id,
        name: t.name,
      })),
    };
  }

  return null;
};

const getUserAccessibleDocuments = async (userId: string, organizationId?: string) => {
  const docs = await prisma.document.findMany({
    where: {
      OR: [
        { createdById: userId },
        { collaborators: { some: { userId } } },
        ...(organizationId ? [{ organizationId }] : []),
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
  autoExecute: boolean = false
) => {
  const sanitizedPrompt = sanitizeAiInput(rawPrompt);
  const orgContext = await getUserOrganizationContext(userId);
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

  const validActions = new Set(['CREATE_TEAM', 'SCHEDULE_MEETING', 'SHARE_DOCUMENT', 'NOTIFY_MEMBERS']);
  const sanitizedSteps: WorkflowStep[] = [];

  for (let i = 0; i < parsedPlan.steps.length; i++) {
    const s = parsedPlan.steps[i];
    if (!validActions.has(s.action)) {
      continue;
    }
    sanitizedSteps.push({
      step: i + 1,
      action: s.action,
      description: s.description || s.action.replace('_', ' ').toLowerCase(),
      params: s.params || {},
    });
  }

  if (sanitizedSteps.length === 0) {
    throw new ApiError(400, 'No supported workflow actions found in the prompt');
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

  const variables = new Map<string, string>();
  const results: Array<{
    step: number;
    action: string;
    description?: string;
    success: boolean;
    resource?: any;
    error?: string;
  }> = [];

  let orgId = plan.organizationId;
  if (!orgId) {
    const userOrg = await getUserOrganizationContext(userId);
    orgId = userOrg?.organizationId;
  }

  for (const step of plan.steps) {
    const resolvedParams = resolveVariables(step.params, variables);

    try {
      if (step.action === 'CREATE_TEAM') {
        if (!orgId) {
          throw new ApiError(400, 'An active organization is required to create a team');
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
        for (const targetId of memberIds) {
          if (targetId && targetId !== userId) {
            try {
              await addTeamMember(orgId, team.id, userId, OrgRole.ORG_ADMIN, targetId, 'member');
            } catch (memberErr) {
              logger.warn(`Could not add member ${targetId} to team ${team.id}:`, memberErr);
            }
          }
        }

        results.push({
          step: step.step,
          action: step.action,
          description: step.description,
          success: true,
          resource: {
            teamId: team.id,
            name: team.name,
            memberCount: memberIds.length + 1,
          },
        });
      } else if (step.action === 'SCHEDULE_MEETING') {
        let startTime = resolvedParams.startTime ? new Date(resolvedParams.startTime) : null;
        if (!startTime || isNaN(startTime.getTime()) || startTime.getTime() <= Date.now()) {
          startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }

        const meetingTitle = String(resolvedParams.title || 'Team Meeting').trim();
        const targetTeamId = resolvedParams.teamId ? String(resolvedParams.teamId) : undefined;

        const meeting = await createScopedMeeting(userId, {
          title: meetingTitle,
          scopeType: targetTeamId ? MeetingScopeType.TEAM : (orgId ? MeetingScopeType.ORGANIZATION : MeetingScopeType.PERSONAL),
          organizationId: orgId,
          teamId: targetTeamId,
          scheduledStartTime: startTime,
        });

        variables.set(`$step${step.step}.meetingCode`, meeting.code);
        variables.set(`$step${step.step}.id`, meeting.code);

        results.push({
          step: step.step,
          action: step.action,
          description: step.description,
          success: true,
          resource: {
            meetingCode: meeting.code,
            title: meeting.title,
            scheduledStartTime: meeting.scheduledStartTime,
            link: meeting.link,
          },
        });
      } else if (step.action === 'SHARE_DOCUMENT') {
        const documentId = String(resolvedParams.documentId || '').trim();
        if (!documentId) {
          throw new ApiError(400, 'Document ID is required to share document');
        }

        const doc = await prisma.document.findUnique({
          where: { id: documentId },
          select: { id: true, title: true, createdById: true },
        });

        if (!doc) {
          throw new ApiError(404, 'Document to share was not found');
        }

        const targetTeamId = resolvedParams.teamId ? String(resolvedParams.teamId) : undefined;
        if (targetTeamId) {
          await prisma.document.update({
            where: { id: doc.id },
            data: { teamId: targetTeamId },
          });
        }

        const memberIds = Array.isArray(resolvedParams.memberIds) ? resolvedParams.memberIds : [];
        for (const targetId of memberIds) {
          if (targetId && targetId !== userId) {
            try {
              await addCollaborator(userId, doc.id, {
                userId: targetId,
                permission: 'VIEW',
              });
            } catch (collabErr) {
              logger.warn(`Could not add collaborator ${targetId} to doc ${doc.id}:`, collabErr);
            }
          }
        }

        variables.set(`$step${step.step}.documentId`, doc.id);

        results.push({
          step: step.step,
          action: step.action,
          description: step.description,
          success: true,
          resource: {
            documentId: doc.id,
            title: doc.title,
            sharedWithTeam: !!targetTeamId,
          },
        });
      } else if (step.action === 'NOTIFY_MEMBERS') {
        const userIds = Array.isArray(resolvedParams.userIds) ? resolvedParams.userIds : [];
        const notifTitle = String(resolvedParams.title || 'Workflow Update').trim();
        const notifMessage = String(resolvedParams.message || 'A new workflow action was completed.').trim();

        const validUsers = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true },
        });

        for (const u of validUsers) {
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
            getIO().to(u.id).emit('notification:new', {
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
            recipientsCount: validUsers.length,
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
  }

  try {
    getIO().to(userId).emit('workflow:completed', {
      planId,
      status: 'COMPLETED',
      results,
    });
  } catch (ioErr) {
    logger.warn('Failed to emit workflow:completed socket event', ioErr);
  }

  try {
    await redis.del(`workflow:plan:${planId}`);
  } catch {}
  inMemoryPlans.delete(planId);

  return {
    planId,
    summary: plan.summary,
    status: 'COMPLETED',
    executedAt: new Date(),
    results,
  };
};
