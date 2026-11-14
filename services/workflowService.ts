import crypto from 'crypto';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { getIO } from '../sockets/socketServer.js';
import { generateRawCompletion, sanitizeAiInput } from './aiService.js';
import { createTeam, addTeamMember } from './teamService.js';
import { createOrganization } from './organizationService.js';
import { createCommunity } from './communityService.js';
import { createCommunityPost } from './postService.js';
import { createScopedMeeting } from './meetingService.js';
import { addCollaborator, checkDocumentAccess } from './documentService.js';
import { getOrCreateDirectConversation, saveMessage } from './chatService.js';
import { CHAT_EVENTS } from '../utils/constants.js';
import { MeetingScopeType, NotificationType, OrgRole, DocumentScopeType } from '@prisma/client';
import { WorkflowStep, workflowStepSchema } from '../validators/workflowValidators.js';
import { sendPushToOfflineUsers } from './notificationService.js';

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

const getUserCommunities = async (userId: string) => {
  const memberships = await prisma.communityMember.findMany({
    where: { userId },
    select: {
      community: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
    },
    take: 50,
  });
  const ownedCommunities = await prisma.community.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      name: true,
      description: true,
    },
    take: 50,
  });
  const map = new Map<string, { id: string; name: string; description?: string | null }>();
  for (const m of memberships) {
    if (m.community) {
      map.set(m.community.id, m.community);
    }
  }
  for (const c of ownedCommunities) {
    map.set(c.id, c);
  }
  return Array.from(map.values());
};

export const generateWorkflowPlan = async (
  userId: string,
  rawPrompt: string,
  organizationId?: string,
  autoExecute: boolean = false,
  timezone?: string,
  clientTime?: string
) => {
  const sanitizedPrompt = sanitizeAiInput(rawPrompt);
  const orgContext = await getUserOrganizationContext(userId, organizationId);
  if (organizationId && !orgContext) {
    throw new ApiError(403, 'You do not have access to the specified organization');
  }
  const accessibleDocs = await getUserAccessibleDocuments(userId, orgContext?.organizationId);
  const userCommunities = await getUserCommunities(userId);

  const now = clientTime && !isNaN(Date.parse(clientTime)) ? new Date(clientTime) : new Date();
  const userTimezone = timezone && timezone.trim() ? timezone.trim() : 'Asia/Kolkata';
  let formattedLocalTime = '';
  try {
    formattedLocalTime = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now);
  } catch {
    formattedLocalTime = now.toString();
  }

  const contextData = {
    currentTimeContext: {
      currentUtcIso: now.toISOString(),
      userTimezone,
      currentLocalTime: formattedLocalTime,
    },
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
    communities: userCommunities.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || undefined,
    })),
  };

  const systemInstruction = `You are Quorum's secure workflow orchestration engine.
Your objective is to translate a user's natural language command into an ordered, executable JSON plan of discrete workplace actions.

CRITICAL SECURITY & PRIVACY RULES:
1. Never include internal API endpoints, URLs (like /api/...), system file paths, database schemas, tokens, or credentials in any output field.
2. Only use the following allowed actions:
   - "CREATE_ORGANIZATION"
   - "CREATE_TEAM"
   - "SCHEDULE_MEETING"
   - "SHARE_DOCUMENT"
   - "NOTIFY_MEMBERS"
   - "CREATE_COMMUNITY"
   - "CREATE_COMMUNITY_POST"
   - "SEND_CHAT_MESSAGE"
3. For entity resolution, match names and email addresses mentioned in the prompt to the provided workspace members, communities, and documents. If a member, community, or document cannot be matched with certainty, omit or use best matched ID from the provided context.
4. When an action relies on a resource produced in a previous step, reference it using variable syntax:
   - "$step1.organizationId" or "$step1.orgId" or "$step1.id" for organization created in step 1
   - "$step1.teamId" or "$step1.id" for team created in step 1
   - "$step2.meetingId" or "$step2.meetingCode" for meeting created in step 2
   - "$step1.communityId" or "$step1.id" for community created in step 1
   - "$step1.messageId" or "$step1.id" for chat message created in step 1
5. Parameter requirements per action:
   - "CREATE_ORGANIZATION": { "name": string, "description"?: string }
   - "CREATE_TEAM": { "name": string, "description"?: string, "memberIds"?: string[], "organizationId"?: string }
   - "SCHEDULE_MEETING": { "title": string, "startTime": string (ISO 8601), "durationMinutes"?: number, "teamId"?: string }
   - "SHARE_DOCUMENT": { "documentId": string, "teamId"?: string, "memberIds"?: string[] }
   - "NOTIFY_MEMBERS": { "userIds": string[], "title": string, "message": string }
   - "CREATE_COMMUNITY": { "name": string, "description"?: string }
   - "CREATE_COMMUNITY_POST": { "communityId"?: string, "communityName"?: string, "content": string }
   - "SEND_CHAT_MESSAGE": { "content": string, "recipientUserId"?: string, "recipientName"?: string, "groupName"?: string, "teamId"?: string, "conversationId"?: string }
6. ACTION SELECTION RULES:
   - When the user asks to create, make, setup, or start an organization or company (e.g. "make a new organisation", "create an organization", "create company"), you MUST use "CREATE_ORGANIZATION". DO NOT use "CREATE_TEAM" for organizations or companies.
   - Use "CREATE_TEAM" ONLY when creating a team, squad, department, or group within an organization.
   - When the user asks to post, share, or publish a message, announcement, or post in a community (e.g. "make a post on community named college saying hello guys", "post in community college hello guys"), you MUST use "CREATE_COMMUNITY_POST". Match the community by name against the provided "communities" list in contextData to set "communityId" and include "communityName" and "content". DO NOT use "NOTIFY_MEMBERS" or "CREATE_TEAM" for community posts.
   - When the user asks to create or make a community (e.g. "make a community named xyz", "create community"), use "CREATE_COMMUNITY".
   - When the user asks to write, send, text, or ping a message to a person or someone (e.g. "write a message to Aniket saying hello", "send message to John"), or to a group or team (e.g. "write a message in frontend group saying meeting starts now", "send a message to team dev"), you MUST use "SEND_CHAT_MESSAGE". Match the person against workspace members for "recipientUserId"/"recipientName", or match the group against "teams" for "groupName"/"teamId". DO NOT use "NOTIFY_MEMBERS" or "CREATE_COMMUNITY_POST" for direct or group chat messages.
   - If a prompt requests creating an organization AND then creating teams or meetings in it, step 1 must be "CREATE_ORGANIZATION", and subsequent steps should reference "$step1.organizationId".

CRITICAL DATE & TIME ANCHOR FOR SCHEDULE_MEETING:
- Current Real-World Time: ${formattedLocalTime} (${userTimezone})
- Current UTC ISO: ${now.toISOString()}
- All relative time references like 'today', 'tomorrow', '7:00 PM', 'in 2 hours', 'this afternoon' MUST be computed strictly relative to this real-world time.
- If the user specifies 'today' at a time that has already passed in the current local time, schedule it for tomorrow at the same time.
- NEVER produce dates in the past or placeholder years. The computed 'startTime' MUST be in the future (strictly greater than ${now.toISOString()}).
- Output 'startTime' strictly in ISO 8601 format (e.g. 2026-11-14T13:30:00.000Z).

Output strictly valid JSON with this exact schema:
{
  "summary": "Concise natural language summary of what will be performed",
  "steps": [
    {
      "step": 1,
      "action": "CREATE_ORGANIZATION",
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

    if ((rawStep as any).action === 'POST_COMMUNITY' || (rawStep as any).action === 'CREATE_POST') {
      (rawStep as any).action = 'CREATE_COMMUNITY_POST';
    }
    if ((rawStep as any).action === 'SEND_MESSAGE' || (rawStep as any).action === 'WRITE_MESSAGE') {
      (rawStep as any).action = 'SEND_CHAT_MESSAGE';
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
      const stepData = {
        ...parseResult.data,
        step: newStepNumber,
        description: parseResult.data.description || parseResult.data.action.replace('_', ' ').toLowerCase(),
      };

      if (stepData.action === 'SCHEDULE_MEETING' && stepData.params) {
        const rawStart = stepData.params.startTime;
        if (typeof rawStart === 'string') {
          const parsedStart = new Date(rawStart);
          if (!isNaN(parsedStart.getTime()) && parsedStart.getTime() < Date.now() - 60000) {
            const adjusted = new Date();
            adjusted.setHours(parsedStart.getHours(), parsedStart.getMinutes(), 0, 0);
            if (adjusted.getTime() < Date.now()) {
              adjusted.setDate(adjusted.getDate() + 1);
            }
            stepData.params.startTime = adjusted.toISOString();
          }
        }
      }

      sanitizedSteps.push(stepData);
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
      let createdTeamId: string | undefined;

      try {
        const resolvedParams = resolveVariables(step.params, variables);
        if (step.action === 'CREATE_ORGANIZATION') {
          const orgName = String(resolvedParams.name || 'New Organization').trim();
          const orgDescription = resolvedParams.description ? String(resolvedParams.description).trim() : undefined;

          let org: any = null;
          const existingOrgId = variables.get(`$step${step.step}.organizationId`);
          if (existingOrgId) {
            org = await prisma.organization.findUnique({ where: { id: existingOrgId } });
          }
          if (!org) {
            org = await createOrganization(userId, {
              name: orgName,
              description: orgDescription,
            });
          }

          orgId = org.id;
          variables.set(`$step${step.step}.organizationId`, org.id);
          variables.set(`$step${step.step}.orgId`, org.id);
          variables.set(`$step${step.step}.id`, org.id);
          variables.set(`$step${step.step}.name`, org.name);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              organizationId: org.id,
              name: org.name,
              slug: org.slug,
              description: org.description,
            },
          });
        } else if (step.action === 'CREATE_TEAM') {
          const targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          if (!targetOrgId) {
            throw new ApiError(400, 'An active organization is required to create a team');
          }

          const callerOrg = await getUserOrganizationContext(userId, targetOrgId);
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

          let team: any = null;
          const existingTeamId = variables.get(`$step${step.step}.teamId`);
          if (existingTeamId) {
            team = await prisma.team.findUnique({ where: { id: existingTeamId } });
          }
          if (!team) {
            const existingTeam = await prisma.team.findUnique({
              where: {
                organizationId_name: {
                  organizationId: targetOrgId,
                  name: teamName,
                },
              },
            });
            if (existingTeam) {
              team = existingTeam;
            } else {
              team = await createTeam(targetOrgId, userId, {
                name: teamName,
                description: teamDesc,
              });
              createdTeamId = team.id;
            }
          }

          variables.set(`$step${step.step}.teamId`, team.id);
          variables.set(`$step${step.step}.id`, team.id);
          variables.set(`$step${step.step}.name`, team.name);

          const memberIds = Array.isArray(resolvedParams.memberIds) ? resolvedParams.memberIds : [];
          let addedCount = 1;
          const failedMemberIds: string[] = [];
          for (const targetId of memberIds) {
            if (targetId && targetId !== userId) {
              try {
                const existingMember = await prisma.teamMember.findFirst({
                  where: { teamId: team.id, userId: targetId }
                });
                if (!existingMember) {
                  await addTeamMember(targetOrgId, team.id, userId, callerRole, targetId, 'member');
                }
                addedCount++;
              } catch (memberErr) {
                failedMemberIds.push(targetId);
                logger.warn(`Could not add member ${targetId} to team ${team.id}:`, memberErr);
              }
            }
          }

          const hasMemberFailures = failedMemberIds.length > 0;
          if (hasMemberFailures) {
            if (createdTeamId) {
              try {
                await prisma.team.delete({ where: { id: createdTeamId } });
              } catch (delErr) {
                logger.warn(`Failed to clean up team ${createdTeamId} after member failure`, delErr);
              }
            }
            variables.delete(`$step${step.step}.teamId`);
            variables.delete(`$step${step.step}.id`);
            variables.delete(`$step${step.step}.name`);
          }

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
          let startTime = new Date(resolvedParams.startTime);
          if (isNaN(startTime.getTime())) {
            throw new ApiError(400, 'Invalid meeting startTime format');
          }
          if (startTime.getTime() < Date.now() - 60000) {
            const adjusted = new Date();
            adjusted.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
            if (adjusted.getTime() < Date.now()) {
              adjusted.setDate(adjusted.getDate() + 1);
            }
            if (adjusted.getTime() >= Date.now()) {
              startTime = adjusted;
            } else {
              throw new ApiError(400, 'Meeting startTime cannot be in the past');
            }
          }

          const meetingTitle = String(resolvedParams.title || 'Team Meeting').trim();
          const targetTeamId = resolvedParams.teamId ? String(resolvedParams.teamId) : undefined;
          const durationMinutes = resolvedParams.durationMinutes !== undefined && resolvedParams.durationMinutes !== null
            ? Number(resolvedParams.durationMinutes)
            : undefined;

          if (durationMinutes !== undefined && (isNaN(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440)) {
            throw new ApiError(400, 'durationMinutes must be a positive number between 1 and 1440');
          }

          let meeting: any = null;
          const existingMeetingId = variables.get(`$step${step.step}.meetingId`);
          if (existingMeetingId) {
            meeting = await prisma.meeting.findUnique({ where: { id: existingMeetingId } });
          }
          if (!meeting) {
            const recentMeeting = await prisma.meeting.findFirst({
              where: {
                hostId: userId,
                title: meetingTitle,
                organizationId: orgId || null,
                teamId: targetTeamId || null,
                scheduledStartTime: startTime,
                createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
              },
              orderBy: { createdAt: 'desc' },
            });
            if (recentMeeting) {
              meeting = recentMeeting;
            } else {
              meeting = await createScopedMeeting(userId, {
                title: meetingTitle,
                scopeType: targetTeamId ? MeetingScopeType.TEAM : (orgId ? MeetingScopeType.ORGANIZATION : MeetingScopeType.PERSONAL),
                organizationId: orgId,
                teamId: targetTeamId,
                scheduledStartTime: startTime,
                durationMinutes,
              });
            }
          }

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
            const notifHash = crypto.createHash('sha256').update(`notif:${planId}:${step.step}:${u.id}`).digest('hex');
            const notifId = `${notifHash.slice(0, 8)}-${notifHash.slice(8, 12)}-4${notifHash.slice(13, 16)}-a${notifHash.slice(17, 20)}-${notifHash.slice(20, 32)}`;

            const existingNotif = await prisma.notification.findUnique({
              where: { id: notifId },
            });

            if (!existingNotif) {
              await prisma.notification.create({
                data: {
                  id: notifId,
                  recipientId: u.id,
                  actorId: userId,
                  type: NotificationType.SYSTEM,
                  title: notifTitle,
                  body: notifMessage,
                  data: { planId, step: step.step },
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

              sendPushToOfflineUsers(
                [u.id],
                notifTitle,
                notifMessage,
                {
                  type: 'SYSTEM',
                  notificationId: notifId,
                  planId,
                  step: String(step.step)
                },
                {
                  tag: notifId,
                  channelId: 'quorum_chat_messages',
                  sound: 'default'
                }
              ).catch((pushErr) => {
                logger.warn('Failed to send push notification for workflow to user ' + u.id, pushErr);
              });
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
        } else if (step.action === 'CREATE_COMMUNITY') {
          const commName = String(resolvedParams.name || 'New Community').trim();
          const commDesc = resolvedParams.description ? String(resolvedParams.description).trim() : undefined;

          let community: any = null;
          const existingCommId = variables.get(`$step${step.step}.communityId`);
          if (existingCommId) {
            community = await prisma.community.findUnique({ where: { id: existingCommId } });
          }
          if (!community) {
            community = await createCommunity(userId, {
              name: commName,
              description: commDesc,
            });
          }

          variables.set(`$step${step.step}.communityId`, community.id);
          variables.set(`$step${step.step}.id`, community.id);
          variables.set(`$step${step.step}.name`, community.name);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              communityId: community.id,
              name: community.name,
              description: community.description,
            },
          });
        } else if (step.action === 'CREATE_COMMUNITY_POST' || step.action === 'POST_COMMUNITY' || step.action === 'CREATE_POST') {
          let targetCommunityId = resolvedParams.communityId ? String(resolvedParams.communityId).trim() : undefined;
          const postContent = String(resolvedParams.content || resolvedParams.message || '').trim();

          if (!postContent) {
            throw new ApiError(400, 'Content is required to create a community post');
          }

          if ((!targetCommunityId || targetCommunityId.startsWith('$')) && resolvedParams.communityName) {
            const queryName = String(resolvedParams.communityName).trim();
            const communityRecord = await prisma.community.findFirst({
              where: {
                name: {
                  equals: queryName,
                  mode: 'insensitive',
                },
              },
              select: { id: true, ownerId: true },
            });
            if (communityRecord) {
              const existingMember = await prisma.communityMember.findUnique({
                where: {
                  communityId_userId: {
                    communityId: communityRecord.id,
                    userId,
                  },
                },
              });
              if (!existingMember && communityRecord.ownerId === userId) {
                await prisma.communityMember.create({
                  data: {
                    communityId: communityRecord.id,
                    userId,
                    role: 'OWNER',
                  },
                });
              }
              targetCommunityId = communityRecord.id;
            } else {
              const partialCommunity = await prisma.community.findFirst({
                where: {
                  name: {
                    contains: queryName,
                    mode: 'insensitive',
                  },
                },
                select: { id: true, ownerId: true },
              });
              if (partialCommunity) {
                const existingMember = await prisma.communityMember.findUnique({
                  where: {
                    communityId_userId: {
                      communityId: partialCommunity.id,
                      userId,
                    },
                  },
                });
                if (!existingMember && partialCommunity.ownerId === userId) {
                  await prisma.communityMember.create({
                    data: {
                      communityId: partialCommunity.id,
                      userId,
                      role: 'OWNER',
                    },
                  });
                }
                targetCommunityId = partialCommunity.id;
              }
            }
          }

          if (!targetCommunityId || targetCommunityId.startsWith('$')) {
            const userComm = await prisma.communityMember.findFirst({
              where: { userId },
              select: { communityId: true },
            });
            targetCommunityId = userComm?.communityId;
          }

          if (!targetCommunityId) {
            throw new ApiError(404, `Target community '${resolvedParams.communityName || ''}' not found or you are not a member`);
          }

          const post = await createCommunityPost(userId, targetCommunityId, {
            content: postContent,
          });

          variables.set(`$step${step.step}.postId`, post.id);
          variables.set(`$step${step.step}.id`, post.id);

          results.push({
            step: step.step,
            action: 'CREATE_COMMUNITY_POST',
            description: step.description,
            success: true,
            resource: {
              postId: post.id,
              communityId: targetCommunityId,
              content: post.content,
              channelId: post.channelId,
            },
          });
        } else if (step.action === 'SEND_CHAT_MESSAGE' || step.action === 'SEND_MESSAGE' || step.action === 'WRITE_MESSAGE') {
          const content = String(resolvedParams.content || resolvedParams.message || '').trim();
          if (!content) {
            throw new ApiError(400, 'Message content is required');
          }

          let targetConvId: string | undefined = resolvedParams.conversationId
            ? String(resolvedParams.conversationId).trim()
            : undefined;

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.teamId) {
            const teamConv = await prisma.conversation.findFirst({
              where: { teamId: String(resolvedParams.teamId).trim() },
              select: { id: true }
            });
            if (teamConv) {
              targetConvId = teamConv.id;
            }
          }

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.recipientUserId) {
            const targetUserId = String(resolvedParams.recipientUserId).trim();
            if (targetUserId !== userId) {
              const directConv = await getOrCreateDirectConversation(userId, targetUserId);
              if (directConv) {
                targetConvId = directConv.id;
              }
            }
          }

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.recipientName) {
            const queryName = String(resolvedParams.recipientName).trim();
            const matchedUser = await prisma.user.findFirst({
              where: {
                name: {
                  contains: queryName,
                  mode: 'insensitive'
                }
              },
              select: { id: true }
            });
            if (matchedUser && matchedUser.id !== userId) {
              const directConv = await getOrCreateDirectConversation(userId, matchedUser.id);
              if (directConv) {
                targetConvId = directConv.id;
              }
            }
          }

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.groupName) {
            const queryGroup = String(resolvedParams.groupName).trim();
            const matchingConv = await prisma.conversation.findFirst({
              where: {
                participants: { some: { userId } },
                name: {
                  contains: queryGroup,
                  mode: 'insensitive'
                }
              },
              select: { id: true }
            });
            if (matchingConv) {
              targetConvId = matchingConv.id;
            } else {
              const team = await prisma.team.findFirst({
                where: {
                  name: {
                    contains: queryGroup,
                    mode: 'insensitive'
                  },
                  members: { some: { userId } }
                },
                select: { id: true }
              });
              if (team) {
                const teamConv = await prisma.conversation.findFirst({
                  where: { teamId: team.id },
                  select: { id: true }
                });
                if (teamConv) {
                  targetConvId = teamConv.id;
                }
              }
            }
          }

          if (!targetConvId || targetConvId.startsWith('$')) {
            throw new ApiError(404, `Could not find recipient or group conversation for '${resolvedParams.recipientName || resolvedParams.groupName || 'message'}'`);
          }

          const { message, participants } = await saveMessage(
            userId,
            targetConvId,
            content
          );

          try {
            const io = getIO();
            const conversationRooms = [`conversation:${message.conversationId}`];
            io.to(conversationRooms).emit(CHAT_EVENTS.MESSAGE_NEW, message);
            participants.forEach((p) => {
              io.to(`user:${p.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
                conversationId: message.conversationId,
                lastMessage: message
              });
            });

            const recipientUserIds = participants
              .filter((p) => p.userId !== userId)
              .map((p) => p.userId);

            if (recipientUserIds.length > 0) {
              const sender = await prisma.user.findUnique({
                where: { id: userId },
                select: { name: true }
              });
              sendPushToOfflineUsers(
                recipientUserIds,
                sender?.name || 'New Message',
                content.slice(0, 100),
                {
                  type: 'NEW_MESSAGE',
                  conversationId: message.conversationId,
                  messageId: message.id
                },
                {
                  tag: `chat_${message.conversationId}`,
                  channelId: 'quorum_chat_messages',
                  sound: 'default'
                }
              ).catch((pushErr) => {
                logger.warn('Failed to send push notification for chat message', pushErr);
              });
            }
          } catch (emitErr) {
            logger.warn('Failed to dispatch chat socket events', emitErr);
          }

          variables.set(`$step${step.step}.messageId`, message.id);
          variables.set(`$step${step.step}.conversationId`, message.conversationId);
          variables.set(`$step${step.step}.id`, message.id);

          results.push({
            step: step.step,
            action: 'SEND_CHAT_MESSAGE',
            description: step.description,
            success: true,
            resource: {
              messageId: message.id,
              conversationId: message.conversationId,
              content: message.content,
              recipientCount: participants.length - 1
            }
          });
        }
      } catch (err: any) {
        logger.error(`Error executing workflow step ${step.step} (${step.action})`, err);
        if (step.action === 'CREATE_TEAM' && createdTeamId) {
          try {
            await prisma.team.delete({ where: { id: createdTeamId } });
          } catch {}
          variables.delete(`$step${step.step}.teamId`);
          variables.delete(`$step${step.step}.id`);
          variables.delete(`$step${step.step}.name`);
        }
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
