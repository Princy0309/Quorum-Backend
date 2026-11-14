import crypto from 'crypto';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { getIO } from '../sockets/socketServer.js';
import { generateRawCompletion, sanitizeAiInput } from './aiService.js';
import { createTeam, addTeamMember, removeTeamMember } from './teamService.js';
import { createOrganization, createOrganizationInvite } from './organizationService.js';
import { createCommunity, inviteUserToCommunity, removeCommunityMember } from './communityService.js';
import { createCommunityPost, deleteCommunityPost } from './postService.js';
import { createScopedMeeting, cancelMeeting } from './meetingService.js';
import { createDocument, addCollaborator, checkDocumentAccess, updateDocument } from './documentService.js';
import { createTask, updateTaskStatus } from './taskService.js';
import { createProject, inviteProjectMember, createProjectTask, updateProjectMember } from './projectService.js';
import { createWhiteboard } from './whiteboardService.js';
import { getOrCreateDirectConversation, saveMessage, deleteMessage, pinMessage, unpinMessage } from './chatService.js';
import { createCalendarEvent, deleteCalendarEvent } from './calendarService.js';
import { CHAT_EVENTS } from '../utils/constants.js';
import { MeetingScopeType, MeetingStatus, NotificationType, OrgRole, DocumentScopeType, TaskStatus, ProjectRole, TaskPriority } from '@prisma/client';
import { WorkflowStep, workflowStepSchema } from '../validators/workflowValidators.js';
import { sendPushToOfflineUsers } from './notificationService.js';
import { setUserCustomStatus, PresenceStatus } from './presenceService.js';
import { broadcastUserPresenceUpdate } from '../sockets/handlers/presenceHandler.js';

const sanitizeWorkflowText = (input: string): string => {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '')
    .replace(/on\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/on\w+\s*=\s*[^>\s]+/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .trim();
};

const redactSensitiveData = (text: string): string => {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/(?:sk-[a-zA-Z0-9_-]{20,}|AIza[0-9A-Za-z-_]{35}|ghp_[a-zA-Z0-9]{36}|xox[baprs]-[a-zA-Z0-9-]+|AKIA[0-9A-Z]{16})/g, '[REDACTED_API_KEY]')
    .replace(/(?:Bearer\s+[a-zA-Z0-9_\-\.]{20,})/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(["']?(?:password|secret|token|apiKey|auth)["']?\s*[:=]\s*["'])([^"']{4,})(["'])/gi, '$1[REDACTED]$3');
};

const redactSensitiveObject = (obj: any): any => {
  if (typeof obj === 'string') return redactSensitiveData(obj);
  if (Array.isArray(obj)) return obj.map(redactSensitiveObject);
  if (obj !== null && typeof obj === 'object') {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/password|secret|token|apiKey|auth/i.test(k) && typeof v === 'string') {
        res[k] = '[REDACTED]';
      } else {
        res[k] = redactSensitiveObject(v);
      }
    }
    return res;
  }
  return obj;
};

const executeWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number, stepNum: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(504, `Workflow step ${stepNum} timed out after ${timeoutMs / 1000}s`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

const ADVERSARIAL_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /system\s+override/i,
  /reveal\s+(?:your\s+)?(?:system\s+prompt|instructions)/i,
  /disregard\s+(?:all\s+)?(?:rules|safeguards)/i,
  /bypass\s+(?:security|confirmation|safeguards|guards)/i,
  /act\s+as\s+(?:an?\s+)?unrestricted/i,
  /jailbreak/i,
];

const validateNoPromptInjection = (prompt: string): void => {
  if (!prompt || typeof prompt !== 'string') return;
  for (const pattern of ADVERSARIAL_PATTERNS) {
    if (pattern.test(prompt)) {
      throw new ApiError(400, 'Security violation: Prompt contains disallowed adversarial or prompt injection sequences');
    }
  }
};

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'tempmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'throwawaymail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'dispostable.com',
  'fakeinbox.com',
]);

const SSRF_REGEX = /(?:https?:\/\/)?(?:127\.0\.0\.1|localhost|0\.0\.0\.0|169\.254\.169\.254|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/|\?|#|$)/i;

const validateSafeUrlAndDomain = (input: string): void => {
  if (!input || typeof input !== 'string') return;
  if (SSRF_REGEX.test(input)) {
    throw new ApiError(400, 'Security violation: Private network addresses or SSRF targets are not permitted');
  }
  const emailMatch = input.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    const domain = emailMatch[1].toLowerCase();
    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
      throw new ApiError(400, 'Security violation: Disposable or temporary email domains are not allowed');
    }
  }
};

const enforceHourlyVelocityQuota = async (userId: string, resourceType: 'team' | 'project' | 'document', maxPerHour: number): Promise<void> => {
  try {
    const key = `workflow:quota:${resourceType}:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 3600);
    }
    if (count > maxPerHour) {
      throw new ApiError(429, `Hourly creation quota exceeded for ${resourceType}s (max ${maxPerHour}/hour). Please wait before creating more.`);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }
};

const recordWorkflowAuditEvent = async (event: {
  planId: string;
  userId: string;
  organizationId?: string;
  summary: string;
  status: string;
  results: any[];
  timestamp: string;
}): Promise<void> => {
  try {
    const orgKey = event.organizationId || 'global';
    const auditKey = `workflow:audit:${orgKey}`;
    const payload = JSON.stringify({
      auditId: 'wf_audit_' + crypto.randomBytes(6).toString('hex'),
      ...event,
    });
    await redis.lpush(auditKey, payload);
    await redis.ltrim(auditKey, 0, 999);
  } catch (err) {
    logger.warn('Failed to record workflow audit event', err);
  }
};

const checkAndAdjustMeetingConflict = async (
  hostId: string,
  requestedStart: Date,
  durationMinutes: number = 60,
  excludeMeetingCode?: string
): Promise<Date> => {
  let adjustedStart = new Date(requestedStart.getTime());
  let iterations = 0;
  const maxIterations = 5;

  while (iterations < maxIterations) {
    const windowStart = adjustedStart;
    const windowEnd = new Date(windowStart.getTime() + durationMinutes * 60 * 1000);

    const conflict = await prisma.meeting.findFirst({
      where: {
        hostId,
        status: { in: [MeetingStatus.SCHEDULED, MeetingStatus.ACTIVE] },
        code: excludeMeetingCode ? { not: excludeMeetingCode } : undefined,
        scheduledStartTime: {
          lt: windowEnd,
        },
      },
      select: {
        code: true,
        scheduledStartTime: true,
      },
      orderBy: { scheduledStartTime: 'asc' },
    });

    if (!conflict || !conflict.scheduledStartTime) {
      break;
    }

    const conflictStart = conflict.scheduledStartTime;
    const conflictDuration = 60;
    const conflictEnd = new Date(conflictStart.getTime() + conflictDuration * 60 * 1000);

    if (conflictEnd.getTime() > windowStart.getTime() && conflictStart.getTime() < windowEnd.getTime()) {
      adjustedStart = new Date(conflictEnd.getTime() + 5 * 60 * 1000);
      iterations++;
    } else {
      break;
    }
  }

  return adjustedStart;
};

const DESTRUCTIVE_ACTIONS = new Set([
  'DELETE_CHAT_MESSAGE',
  'DELETE_COMMUNITY_POST',
  'REMOVE_TEAM_MEMBER',
  'REMOVE_COMMUNITY_MEMBER',
  'CANCEL_MEETING',
  'ARCHIVE_DOCUMENT',
  'UNPIN_CHAT_MESSAGE',
  'DELETE_CALENDAR_EVENT',
]);

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

const getUserOrganizationContext = async (userId: string, targetOrgId?: string, queryPromptOrOrgName?: string) => {
  if (!targetOrgId && queryPromptOrOrgName) {
    const userOrgs = await prisma.organization.findMany({
      where: {
        OR: [
          { members: { some: { userId } } },
          { ownerId: userId },
        ],
      },
      select: { id: true, name: true },
    });
    const lowerQuery = queryPromptOrOrgName.toLowerCase();
    for (const org of userOrgs) {
      const orgName = org.name.toLowerCase();
      const slugOrg = orgName.replace(/[^a-z0-9]/g, '');
      const cleanQuery = lowerQuery.replace(/[^a-z0-9]/g, '');
      if (lowerQuery.includes(orgName) || (slugOrg.length >= 3 && cleanQuery.includes(slugOrg))) {
        targetOrgId = org.id;
        break;
      }
    }
  }

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

const getAllUserOrganizationsContext = async (userId: string) => {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          teams: { select: { id: true, name: true } },
          members: {
            select: {
              role: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
    },
  });
  const owned = await prisma.organization.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      name: true,
      teams: { select: { id: true, name: true } },
      members: {
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  const map = new Map<string, { id: string; name: string; teams: { id: string; name: string; organizationId: string; organizationName: string }[]; members: { id: string; name: string; email: string; role: string; organizationId: string; organizationName: string }[] }>();
  for (const m of memberships) {
    if (m.organization) {
      map.set(m.organization.id, {
        id: m.organization.id,
        name: m.organization.name,
        teams: m.organization.teams.map((t) => ({ ...t, organizationId: m.organization.id, organizationName: m.organization.name })),
        members: m.organization.members.map((mem) => ({
          id: mem.user.id,
          name: mem.user.name,
          email: mem.user.email,
          role: mem.role,
          organizationId: m.organization.id,
          organizationName: m.organization.name,
        })),
      });
    }
  }
  for (const o of owned) {
    if (!map.has(o.id)) {
      map.set(o.id, {
        id: o.id,
        name: o.name,
        teams: o.teams.map((t) => ({ ...t, organizationId: o.id, organizationName: o.name })),
        members: o.members.map((mem) => ({
          id: mem.user.id,
          name: mem.user.name,
          email: mem.user.email,
          role: mem.role,
          organizationId: o.id,
          organizationName: o.name,
        })),
      });
    }
  }
  return Array.from(map.values());
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

const getUserProjects = async (userId: string, organizationId?: string) => {
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { createdById: userId },
        { members: { some: { userId } } },
        ...(organizationId ? [{ organizationId }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      organizationId: true,
    },
    take: 50,
  });
  return projects;
};

export const generateWorkflowPlan = async (
  userId: string,
  rawPrompt: string,
  organizationId?: string,
  autoExecute: boolean = false,
  timezone?: string,
  clientTime?: string,
  confirmed: boolean = false
) => {
  try {
    const genRateKey = `workflow:ratelimit:generate:${userId}`;
    const genCount = await redis.incr(genRateKey);
    if (genCount === 1) {
      await redis.expire(genRateKey, 60);
    }
    if (genCount > 5) {
      throw new ApiError(429, 'Rate limit exceeded: You can only generate up to 5 workflows per minute. Please try again shortly.');
    }
  } catch (rateErr) {
    if (rateErr instanceof ApiError) throw rateErr;
  }

  const sanitizedPrompt = sanitizeAiInput(rawPrompt);
  validateNoPromptInjection(sanitizedPrompt);

  const promptHash = crypto.createHash('sha256').update(`${userId}:${sanitizedPrompt}:${organizationId || ''}`).digest('hex');
  const idempotencyKey = `workflow:idempotency:${userId}:${promptHash}`;
  try {
    const existingPlanId = await redis.get(idempotencyKey);
    if (existingPlanId) {
      const existingPlan = await getPlan(existingPlanId);
      if (existingPlan && (Date.now() - new Date(existingPlan.createdAt).getTime()) < 15000) {
        if (autoExecute) {
          return await executeWorkflowPlan(userId, existingPlanId, confirmed);
        }
        return {
          planId: existingPlan.planId,
          summary: existingPlan.summary,
          steps: existingPlan.steps,
          requiresConfirmation: true,
        };
      }
    }
  } catch (idempErr) {
    logger.warn('Failed to check workflow idempotency cache', idempErr);
  }

  const orgContext = await getUserOrganizationContext(userId, organizationId, sanitizedPrompt);
  if (organizationId && !orgContext) {
    throw new ApiError(403, 'You do not have access to the specified organization');
  }
  const allUserOrgs = await getAllUserOrganizationsContext(userId);
  const accessibleDocs = await getUserAccessibleDocuments(userId, orgContext?.organizationId);
  const userCommunities = await getUserCommunities(userId);
  const userProjects = await getUserProjects(userId, orgContext?.organizationId);

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
    organizations: allUserOrgs.map((o) => ({
      id: o.id,
      name: o.name,
    })),
    members: (orgContext?.availableMembers && orgContext.availableMembers.length > 0)
      ? orgContext.availableMembers
      : allUserOrgs.flatMap((o) => o.members),
    teams: (orgContext?.availableTeams && orgContext.availableTeams.length > 0)
      ? orgContext.availableTeams
      : allUserOrgs.flatMap((o) => o.teams),
    projects: userProjects.map((p) => ({
      id: p.id,
      name: p.name,
      organizationId: p.organizationId,
    })),
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
   - "ADD_TEAM_MEMBER"
   - "REMOVE_TEAM_MEMBER"
   - "INVITE_ORG_MEMBER"
   - "SCHEDULE_MEETING"
   - "SHARE_DOCUMENT"
   - "CREATE_DOCUMENT"
   - "CREATE_TASK"
   - "CREATE_PROJECT"
   - "CREATE_WHITEBOARD"
   - "CREATE_POLL"
   - "NOTIFY_MEMBERS"
   - "CREATE_COMMUNITY"
   - "CREATE_COMMUNITY_POST"
   - "INVITE_COMMUNITY_MEMBER"
   - "REMOVE_COMMUNITY_MEMBER"
   - "SEND_CHAT_MESSAGE"
   - "DELETE_CHAT_MESSAGE"
   - "DELETE_COMMUNITY_POST"
   - "START_VIDEO_CALL"
   - "UPDATE_TASK_STATUS"
   - "CANCEL_MEETING"
   - "PIN_CHAT_MESSAGE"
   - "ADD_PROJECT_MEMBER"
   - "ARCHIVE_DOCUMENT"
   - "SET_USER_STATUS"
   - "RESCHEDULE_MEETING"
   - "CREATE_PROJECT_TASK"
   - "UNPIN_CHAT_MESSAGE"
   - "CREATE_CALENDAR_EVENT"
   - "UPDATE_MEMBER_ROLE"
   - "DELETE_CALENDAR_EVENT"
3. For entity resolution, match names and email addresses mentioned in the prompt to the provided workspace members, communities, and documents. If a member, community, or document cannot be matched with certainty, omit or use best matched ID from the provided context.
4. When an action relies on a resource produced in a previous step, reference it using variable syntax:
   - "$step1.organizationId" or "$step1.orgId" or "$step1.id" for organization created in step 1
   - "$step1.teamId" or "$step1.id" for team created in step 1
   - "$step2.meetingId" or "$step2.meetingCode" or "$step2.link" for meeting/call created in step 2
   - "$step1.documentId" or "$step1.id" for document created or archived in step 1
   - "$step1.taskId" or "$step1.id" for task created or updated in step 1
   - "$step1.projectId" or "$step1.id" for project created or updated in step 1
   - "$step1.projectTaskId" for project task created in step 1
   - "$step1.whiteboardId" or "$step1.id" for whiteboard created in step 1
   - "$step1.pollId" or "$step1.id" for poll created in step 1
   - "$step1.communityId" or "$step1.id" for community created in step 1
   - "$step1.messageId" or "$step1.id" for chat message created or pinned in step 1
   - "$step1.inviteId" or "$step1.id" for invite created in step 1
   - "$step1.deletedMessageId" for deleted message in step 1
   - "$step1.deletedPostId" for deleted post in step 1
   - "$step1.status" for user presence status updated in step 1
   - "$step1.eventId" for calendar event created in step 1
5. Parameter requirements per action:
   - "CREATE_ORGANIZATION": { "name": string, "description"?: string }
   - "CREATE_TEAM": { "name": string, "description"?: string, "memberIds"?: string[], "organizationId"?: string, "organizationName"?: string }
   - "ADD_TEAM_MEMBER": { "teamId"?: string, "teamName"?: string, "memberId"?: string, "memberIds"?: string[], "memberName"?: string, "organizationId"?: string, "organizationName"?: string }
   - "REMOVE_TEAM_MEMBER": { "teamId"?: string, "teamName"?: string, "memberId"?: string, "memberName"?: string, "memberEmail"?: string, "organizationId"?: string, "organizationName"?: string }
   - "INVITE_ORG_MEMBER": { "email"?: string, "memberName"?: string, "role"?: "MEMBER" | "ORG_ADMIN", "teamId"?: string, "teamName"?: string, "organizationId"?: string, "organizationName"?: string }
   - "SCHEDULE_MEETING": { "title": string, "startTime": string (ISO 8601), "durationMinutes"?: number, "teamId"?: string }
   - "RESCHEDULE_MEETING": { "meetingCode"?: string, "code"?: string, "meetingTitle"?: string, "startTime": string (ISO 8601), "durationMinutes"?: number }
   - "START_VIDEO_CALL": { "title"?: string, "participantUserIds"?: string[], "participantNames"?: string[], "teamId"?: string, "teamName"?: string, "organizationId"?: string, "organizationName"?: string, "durationMinutes"?: number, "sendChatMessage"?: boolean }
   - "SHARE_DOCUMENT": { "documentId": string, "teamId"?: string, "memberIds"?: string[] }
   - "CREATE_DOCUMENT": { "title": string, "scopeType"?: "PERSONAL" | "ORGANIZATION" | "TEAM" | "PROJECT", "content"?: string, "organizationId"?: string, "teamId"?: string, "projectId"?: string }
   - "CREATE_TASK": { "title": string, "description"?: string, "dueDate"?: string, "teamId"?: string, "teamName"?: string, "assigneeId"?: string, "assigneeName"?: string, "organizationId"?: string, "organizationName"?: string }
   - "UPDATE_TASK_STATUS": { "taskId"?: string, "taskTitle"?: string, "status"?: "TODO" | "IN_PROGRESS" | "DONE", "teamId"?: string, "organizationId"?: string }
   - "CREATE_PROJECT": { "name": string, "description"?: string, "budget"?: number, "dueDate"?: string, "organizationId"?: string, "organizationName"?: string }
   - "CREATE_PROJECT_TASK": { "projectId"?: string, "projectName"?: string, "title": string, "description"?: string, "dueDate"?: string, "priority"?: "LOW" | "MEDIUM" | "HIGH" | "URGENT", "assigneeId"?: string, "assigneeName"?: string }
   - "ADD_PROJECT_MEMBER": { "projectId"?: string, "projectName"?: string, "email"?: string, "memberName"?: string, "role"?: "PROJECT_MANAGER" | "INTERNAL_MEMBER" | "FREELANCER" | "CLIENT", "hourlyRate"?: number, "companyId"?: string, "companyName"?: string }
   - "UPDATE_MEMBER_ROLE": { "teamId"?: string, "teamName"?: string, "projectId"?: string, "projectName"?: string, "memberId"?: string, "memberName"?: string, "memberEmail"?: string, "role": string }
   - "CREATE_WHITEBOARD": { "name": string, "organizationId"?: string, "organizationName"?: string, "teamId"?: string, "projectId"?: string, "meetingId"?: string }
   - "CREATE_POLL": { "question": string, "options": string[], "allowMultipleAnswers"?: boolean, "recipientUserId"?: string, "recipientName"?: string, "groupName"?: string, "teamId"?: string, "conversationId"?: string }
   - "NOTIFY_MEMBERS": { "userIds": string[], "title": string, "message": string }
   - "CREATE_COMMUNITY": { "name": string, "description"?: string }
   - "CREATE_COMMUNITY_POST": { "communityId"?: string, "communityName"?: string, "content": string }
   - "DELETE_COMMUNITY_POST": { "postId"?: string, "communityId"?: string, "communityName"?: string, "contentQuery"?: string }
   - "INVITE_COMMUNITY_MEMBER": { "communityId"?: string, "communityName"?: string, "userId"?: string, "memberName"?: string, "email"?: string, "role"?: "MEMBER" | "ADMIN" }
   - "REMOVE_COMMUNITY_MEMBER": { "communityId"?: string, "communityName"?: string, "targetUserId"?: string, "memberName"?: string, "memberEmail"?: string }
   - "SEND_CHAT_MESSAGE": { "content": string, "recipientUserId"?: string, "recipientName"?: string, "groupName"?: string, "teamId"?: string, "conversationId"?: string }
   - "DELETE_CHAT_MESSAGE": { "messageId"?: string, "conversationId"?: string, "recipientName"?: string, "recipientUserId"?: string, "groupName"?: string, "teamId"?: string, "contentQuery"?: string, "deleteForEveryone"?: boolean }
   - "PIN_CHAT_MESSAGE": { "messageId"?: string, "conversationId"?: string, "recipientName"?: string, "recipientUserId"?: string, "groupName"?: string, "teamId"?: string, "contentQuery"?: string }
   - "UNPIN_CHAT_MESSAGE": { "messageId"?: string, "conversationId"?: string, "recipientName"?: string, "recipientUserId"?: string, "groupName"?: string, "teamId"?: string, "contentQuery"?: string }
   - "CANCEL_MEETING": { "meetingCode"?: string, "code"?: string, "meetingTitle"?: string }
   - "ARCHIVE_DOCUMENT": { "documentId"?: string, "documentTitle"?: string, "title"?: string }
   - "SET_USER_STATUS": { "status": "AVAILABLE" | "DO_NOT_DISTURB" | "BUSY" | "BE_RIGHT_BACK" | "AWAY" | "OFFLINE", "statusMessage"?: string, "clearAfterMinutes"?: number }
   - "CREATE_CALENDAR_EVENT": { "title": string, "description"?: string, "startDate": string (ISO 8601), "endDate"?: string, "eventType"?: "REMINDER" | "MEETING" | "DEADLINE" | "GENERAL", "isAllDay"?: boolean, "hasReminder"?: boolean, "reminderMinutes"?: number, "attendeeEmails"?: string[] }
   - "DELETE_CALENDAR_EVENT": { "eventId"?: string, "title"?: string }
6. ACTION SELECTION RULES:
   - When the user asks to create, make, setup, or start an organization or company (e.g. "make a new organisation", "create an organization", "create company"), you MUST use "CREATE_ORGANIZATION". DO NOT use "CREATE_TEAM" for organizations or companies.
   - When the user asks to add or invite someone/a member to a team (e.g. "add tanvi to team dev team(frontend)", "add user to team"), you MUST use "ADD_TEAM_MEMBER". DO NOT use "CREATE_TEAM" when adding members to an existing team. Match the team from the provided "teams" list to set "teamId" and "teamName", match the organization from the user prompt or "organizations" list to set "organizationId" and "organizationName", and match the member from "members" to set "memberId" and "memberName".
   - When the user asks to remove or kick someone from a team (e.g. "remove tanvi from team frontend", "kick member from team dev"), you MUST use "REMOVE_TEAM_MEMBER". Match team from "teams" and member from "members".
   - When the user asks to invite someone to an organization or company (e.g. "invite user@example.com to organization", "invite tanvi to company"), you MUST use "INVITE_ORG_MEMBER".
   - Use "CREATE_TEAM" ONLY when creating a NEW team, squad, department, or group within an organization.
   - When the user asks to create, make, or write a document or notes (e.g. "create a document named PRD", "make team document for sprint planning"), you MUST use "CREATE_DOCUMENT".
   - When the user asks to archive a document (e.g. "archive document PRD", "archive doc sprint planning"), you MUST use "ARCHIVE_DOCUMENT". Match document from "documents".
   - When the user asks to create or assign a task (e.g. "create task fix navbar for tanvi in team dev", "assign task deploy to tanvi"), you MUST use "CREATE_TASK".
   - When the user asks to mark a task as done, completed, in progress, todo, or update a task status (e.g. "mark task fix navbar as done", "complete task deploy", "update task status to in progress"), you MUST use "UPDATE_TASK_STATUS".
   - When the user asks to create or start a project (e.g. "create a project named Mobile App", "start website redesign project"), you MUST use "CREATE_PROJECT".
   - When the user asks to create or add a task in a project (e.g. "create task design homepage in project Mobile App", "add project task review pr in Alpha"), you MUST use "CREATE_PROJECT_TASK". Match project from "projects".
   - When the user asks to add or invite a member or freelancer to a project (e.g. "add tanvi to project Mobile App as freelancer", "invite user@example.com to project Alpha"), you MUST use "ADD_PROJECT_MEMBER". Match project from "projects" and member from "members".
   - When the user asks to promote, demote, or change the role of a member in a team or project (e.g. "make tanvi lead of team dev", "change tanvi role to freelancer in project Mobile App"), you MUST use "UPDATE_MEMBER_ROLE".
   - When the user asks to create a whiteboard or canvas (e.g. "create a whiteboard for architecture design", "make whiteboard"), you MUST use "CREATE_WHITEBOARD".
   - When the user asks to create a poll (e.g. "create a poll asking what time to meet with options 2pm, 4pm", "create poll in team dev"), you MUST use "CREATE_POLL".
   - When the user asks to invite or add someone to a community (e.g. "invite tanvi to community college", "add user to community developers"), you MUST use "INVITE_COMMUNITY_MEMBER". Match community from "communities" and member from "members".
   - When the user asks to remove or kick someone from a community (e.g. "remove tanvi from community college", "kick user from community"), you MUST use "REMOVE_COMMUNITY_MEMBER". Match community from "communities".
   - When the user asks to post, share, or publish a message, announcement, or post in a community (e.g. "make a post on community named college saying hello guys", "post in community college hello guys"), you MUST use "CREATE_COMMUNITY_POST". Match the community by name against the provided "communities" list in contextData to set "communityId" and include "communityName" and "content". DO NOT use "NOTIFY_MEMBERS" or "CREATE_TEAM" for community posts.
   - When the user asks to delete, remove, or take down a post in a community (e.g. "delete my post in community college", "delete post saying xyz in tech community"), you MUST use "DELETE_COMMUNITY_POST". Match community from "communities".
   - When the user asks to create or make a community (e.g. "make a community named xyz", "create community"), use "CREATE_COMMUNITY".
   - When the user asks to write, send, text, or ping a message to a person or someone (e.g. "write a message to Aniket saying hello", "send message to John"), or to a group or team (e.g. "write a message in frontend group saying meeting starts now", "send a message to team dev"), you MUST use "SEND_CHAT_MESSAGE". Match the person against workspace members for "recipientUserId"/"recipientName", or match the group against "teams" for "groupName"/"teamId". DO NOT use "NOTIFY_MEMBERS" or "CREATE_COMMUNITY_POST" for direct or group chat messages.
   - When the user asks to delete, unsend, or erase a message in chat (e.g. "delete my last message to Tanvi", "delete message saying hello in dev team", "unsend message"), you MUST use "DELETE_CHAT_MESSAGE". Match recipient or team from context.
   - When the user asks to pin a message in chat (e.g. "pin message saying meeting starts now", "pin my last message to Tanvi", "pin message in dev team"), you MUST use "PIN_CHAT_MESSAGE".
   - When the user asks to unpin a message in chat (e.g. "unpin message in team dev", "unpin last message to Tanvi"), you MUST use "UNPIN_CHAT_MESSAGE".
   - When the user asks to cancel, end, or abort a meeting or call (e.g. "cancel meeting team sync", "cancel meeting code abc-def-ghi", "cancel call"), you MUST use "CANCEL_MEETING".
   - When the user asks to reschedule, move, postpone, or change the time of a meeting (e.g. "reschedule meeting team sync to 5 PM", "move meeting abc-def-ghi to tomorrow 10am"), you MUST use "RESCHEDULE_MEETING".
   - When the user asks to start, make, or launch an instant video call or call someone/a group right now (e.g. "start a video call with Tanvi", "make a video call inviting Aniket and Tanvi", "call team dev", "instant meeting with dev team"), you MUST use "START_VIDEO_CALL". Match participants from "members" and team from "teams".
   - When the user asks to change, update, or set their status or presence (e.g. "change my status to DND", "set status to available", "set status to busy saying coding", "change status to away", "set status to be right back for 30 minutes"), you MUST use "SET_USER_STATUS". Map "DND" to "DO_NOT_DISTURB", "online" to "AVAILABLE", "brb" to "BE_RIGHT_BACK".
   - When the user asks to add an event, reminder, or calendar item (e.g. "remind me to submit timesheet on Friday 5pm", "add calendar event sprint review on Monday"), you MUST use "CREATE_CALENDAR_EVENT".
   - When the user asks to delete, cancel, or remove an event, reminder, or calendar item (e.g. "cancel calendar event sprint review", "delete reminder timesheet", "remove event sprint planning"), you MUST use "DELETE_CALENDAR_EVENT".
   - If a prompt requests creating an organization AND then creating teams or meetings in it, step 1 must be "CREATE_ORGANIZATION", and subsequent steps should reference "$step1.organizationId".

CRITICAL STEP LIMIT RULE:
- Never generate more than 10 steps in a workflow plan. If a request is broad, focus on the first 10 most critical actionable steps.

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
    if ((rawStep as any).action === 'DELETE_MESSAGE' || (rawStep as any).action === 'DELETE_CHAT') {
      (rawStep as any).action = 'DELETE_CHAT_MESSAGE';
    }
    if ((rawStep as any).action === 'DELETE_POST' || (rawStep as any).action === 'REMOVE_COMMUNITY_POST') {
      (rawStep as any).action = 'DELETE_COMMUNITY_POST';
    }
    if ((rawStep as any).action === 'START_CALL' || (rawStep as any).action === 'START_MEETING' || (rawStep as any).action === 'MAKE_VIDEO_CALL' || (rawStep as any).action === 'INSTANT_CALL') {
      (rawStep as any).action = 'START_VIDEO_CALL';
    }
    if ((rawStep as any).action === 'ADD_MEMBER' || (rawStep as any).action === 'INVITE_MEMBER') {
      (rawStep as any).action = 'ADD_TEAM_MEMBER';
    }
    if ((rawStep as any).action === 'ASSIGN_TASK') {
      (rawStep as any).action = 'CREATE_TASK';
    }
    if ((rawStep as any).action === 'INVITE_COMMUNITY' || (rawStep as any).action === 'INVITE_MEMBER_TO_COMMUNITY') {
      (rawStep as any).action = 'INVITE_COMMUNITY_MEMBER';
    }
    if ((rawStep as any).action === 'REMOVE_COMMUNITY' || (rawStep as any).action === 'REMOVE_MEMBER_FROM_COMMUNITY') {
      (rawStep as any).action = 'REMOVE_COMMUNITY_MEMBER';
    }
    if ((rawStep as any).action === 'REMOVE_MEMBER' || (rawStep as any).action === 'REMOVE_FROM_TEAM') {
      (rawStep as any).action = 'REMOVE_TEAM_MEMBER';
    }
    if ((rawStep as any).action === 'INVITE_ORG' || (rawStep as any).action === 'INVITE_TO_ORG') {
      (rawStep as any).action = 'INVITE_ORG_MEMBER';
    }
    if ((rawStep as any).action === 'MAKE_DOCUMENT' || (rawStep as any).action === 'NEW_DOCUMENT') {
      (rawStep as any).action = 'CREATE_DOCUMENT';
    }
    if ((rawStep as any).action === 'MAKE_PROJECT' || (rawStep as any).action === 'NEW_PROJECT') {
      (rawStep as any).action = 'CREATE_PROJECT';
    }
    if ((rawStep as any).action === 'MAKE_WHITEBOARD' || (rawStep as any).action === 'NEW_WHITEBOARD') {
      (rawStep as any).action = 'CREATE_WHITEBOARD';
    }
    if ((rawStep as any).action === 'MAKE_POLL' || (rawStep as any).action === 'NEW_POLL') {
      (rawStep as any).action = 'CREATE_POLL';
    }
    if ((rawStep as any).action === 'COMPLETE_TASK' || (rawStep as any).action === 'MARK_TASK_DONE') {
      (rawStep as any).action = 'UPDATE_TASK_STATUS';
    }
    if ((rawStep as any).action === 'CANCEL_CALL' || (rawStep as any).action === 'DELETE_MEETING') {
      (rawStep as any).action = 'CANCEL_MEETING';
    }
    if ((rawStep as any).action === 'PIN_MESSAGE') {
      (rawStep as any).action = 'PIN_CHAT_MESSAGE';
    }
    if ((rawStep as any).action === 'INVITE_PROJECT_MEMBER' || (rawStep as any).action === 'ASSIGN_PROJECT_MEMBER') {
      (rawStep as any).action = 'ADD_PROJECT_MEMBER';
    }
    if ((rawStep as any).action === 'DELETE_DOCUMENT' || (rawStep as any).action === 'ARCHIVE_DOC') {
      (rawStep as any).action = 'ARCHIVE_DOCUMENT';
    }
    if ((rawStep as any).action === 'UPDATE_USER_STATUS' || (rawStep as any).action === 'CHANGE_STATUS') {
      (rawStep as any).action = 'SET_USER_STATUS';
    }
    if ((rawStep as any).action === 'MOVE_MEETING' || (rawStep as any).action === 'CHANGE_MEETING_TIME') {
      (rawStep as any).action = 'RESCHEDULE_MEETING';
    }
    if ((rawStep as any).action === 'ADD_PROJECT_TASK') {
      (rawStep as any).action = 'CREATE_PROJECT_TASK';
    }
    if ((rawStep as any).action === 'UNPIN_MESSAGE') {
      (rawStep as any).action = 'UNPIN_CHAT_MESSAGE';
    }
    if ((rawStep as any).action === 'SCHEDULE_EVENT' || (rawStep as any).action === 'CREATE_EVENT' || (rawStep as any).action === 'ADD_REMINDER') {
      (rawStep as any).action = 'CREATE_CALENDAR_EVENT';
    }
    if ((rawStep as any).action === 'CHANGE_MEMBER_ROLE' || (rawStep as any).action === 'SET_MEMBER_ROLE') {
      (rawStep as any).action = 'UPDATE_MEMBER_ROLE';
    }
    if ((rawStep as any).action === 'CANCEL_EVENT' || (rawStep as any).action === 'REMOVE_EVENT' || (rawStep as any).action === 'DELETE_EVENT') {
      (rawStep as any).action = 'DELETE_CALENDAR_EVENT';
    }

    if ((rawStep as any).action === 'SET_USER_STATUS' && (rawStep as any).params) {
      const s = String((rawStep as any).params.status || '').toUpperCase().trim();
      if (s === 'DND') (rawStep as any).params.status = 'DO_NOT_DISTURB';
      if (s === 'ONLINE') (rawStep as any).params.status = 'AVAILABLE';
      if (s === 'BRB') (rawStep as any).params.status = 'BE_RIGHT_BACK';
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

      if ((stepData.action === 'SCHEDULE_MEETING' || stepData.action === 'RESCHEDULE_MEETING') && stepData.params) {
        const rawStart = stepData.params.startTime || stepData.params.startDate;
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

      if (stepData.action === 'CREATE_CALENDAR_EVENT' && stepData.params) {
        const rawStart = stepData.params.startDate || stepData.params.startTime;
        if (typeof rawStart === 'string') {
          const parsedStart = new Date(rawStart);
          if (!isNaN(parsedStart.getTime()) && parsedStart.getTime() < Date.now() - 60000) {
            const adjusted = new Date();
            adjusted.setHours(parsedStart.getHours(), parsedStart.getMinutes(), 0, 0);
            if (adjusted.getTime() < Date.now()) {
              adjusted.setDate(adjusted.getDate() + 1);
            }
            stepData.params.startDate = adjusted.toISOString();
          }
        }
      }

      if ((stepData.action === 'CREATE_TASK' || stepData.action === 'CREATE_PROJECT' || stepData.action === 'CREATE_PROJECT_TASK') && stepData.params) {
        const rawDue = stepData.params.dueDate;
        if (typeof rawDue === 'string') {
          const parsedDue = new Date(rawDue);
          if (!isNaN(parsedDue.getTime()) && parsedDue.getTime() < Date.now() - 60000) {
            const adjusted = new Date();
            adjusted.setHours(parsedDue.getHours(), parsedDue.getMinutes(), 0, 0);
            if (adjusted.getTime() < Date.now()) {
              adjusted.setDate(adjusted.getDate() + 1);
            }
            stepData.params.dueDate = adjusted.toISOString();
          }
        }
      }

      if (stepData.params) {
        for (const titleKey of ['title', 'name', 'documentName', 'meetingTitle']) {
          if (typeof stepData.params[titleKey] === 'string' && stepData.params[titleKey].length > 150) {
            stepData.params[titleKey] = stepData.params[titleKey].slice(0, 150).trim();
          }
        }
        for (const contentKey of ['content', 'message', 'description']) {
          if (typeof stepData.params[contentKey] === 'string' && stepData.params[contentKey].length > 5000) {
            stepData.params[contentKey] = stepData.params[contentKey].slice(0, 5000).trim();
          }
        }
        if (Array.isArray(stepData.params.attendeeEmails) && stepData.params.attendeeEmails.length > 50) {
          stepData.params.attendeeEmails = stepData.params.attendeeEmails.slice(0, 50);
        }
      }

      sanitizedSteps.push(stepData);
    }
  }

  if (sanitizedSteps.length > 10) {
    sanitizedSteps.length = 10;
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

  for (const step of sanitizedSteps) {
    const checkForwardDeps = (val: any) => {
      if (typeof val === 'string') {
        const matches = Array.from(val.matchAll(/\$step(\d+)\b/g));
        for (const m of matches) {
          const referencedStep = parseInt(m[1], 10);
          if (referencedStep >= step.step) {
            throw new ApiError(400, `Circular or forward step reference detected: Step ${step.step} references $step${referencedStep}, which has not executed yet`);
          }
        }
      } else if (Array.isArray(val)) {
        val.forEach(checkForwardDeps);
      } else if (val !== null && typeof val === 'object') {
        Object.values(val).forEach(checkForwardDeps);
      }
    };
    checkForwardDeps(step.params);
  }

  if (sanitizedSteps.length === 0) {
    throw new ApiError(400, 'No supported or valid workflow actions found in the prompt');
  }

  for (const step of sanitizedSteps) {
    if (step.action === 'INVITE_ORG_MEMBER') {
      const targetOrg = step.params.organizationId || orgContext?.organizationId;
      if (targetOrg && !targetOrg.startsWith('$')) {
        const callerOrg = await getUserOrganizationContext(userId, targetOrg);
        if (callerOrg && callerOrg.userRole !== OrgRole.ORG_ADMIN && !callerOrg.isOwner) {
          throw new ApiError(403, `Pre-validation check failed: You must be an organization admin or owner to invite members (Step ${step.step})`);
        }
      }
    } else if (step.action === 'REMOVE_COMMUNITY_MEMBER') {
      const targetCommId = step.params.communityId;
      if (targetCommId && !targetCommId.startsWith('$')) {
        const comm = userCommunities.find((c) => c.id === targetCommId);
        if (!comm) {
          throw new ApiError(403, `Pre-validation check failed: You are not a member of the targeted community (Step ${step.step})`);
        }
      }
    }
  }

  const planId = 'wf_plan_' + crypto.randomBytes(6).toString('hex');
  const storedPlan: StoredWorkflowPlan = {
    planId,
    userId,
    organizationId: orgContext?.organizationId,
    summary: redactSensitiveData(parsedPlan.summary),
    steps: redactSensitiveObject(sanitizedSteps),
    createdAt: new Date().toISOString(),
  };

  await savePlan(storedPlan);

  try {
    await redis.set(idempotencyKey, planId, 'EX', 15);
  } catch {}

  const hasDestructiveAction = sanitizedSteps.some((s) => DESTRUCTIVE_ACTIONS.has(s.action));

  if (autoExecute && (!hasDestructiveAction || confirmed)) {
    return await executeWorkflowPlan(userId, planId, confirmed);
  }

  return {
    planId,
    summary: storedPlan.summary,
    steps: storedPlan.steps,
    requiresConfirmation: hasDestructiveAction,
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

export const executeWorkflowPlan = async (userId: string, planId: string, confirmed: boolean = false) => {
  try {
    const execRateKey = `workflow:ratelimit:execute:${userId}`;
    const execCount = await redis.incr(execRateKey);
    if (execCount === 1) {
      await redis.expire(execRateKey, 60);
    }
    if (execCount > 10) {
      throw new ApiError(429, 'Rate limit exceeded: You can only execute up to 10 workflows per minute. Please try again shortly.');
    }
  } catch (rateErr) {
    if (rateErr instanceof ApiError) throw rateErr;
  }

  const plan = await getPlan(planId);
  if (!plan) {
    throw new ApiError(404, 'Workflow plan not found or has expired');
  }

  if (plan.userId !== userId) {
    throw new ApiError(403, 'Not authorized to execute this workflow plan');
  }

  const hasDestructive = plan.steps.some((s) => DESTRUCTIVE_ACTIONS.has(s.action));
  if (hasDestructive && !confirmed) {
    throw new ApiError(400, 'This plan contains destructive actions and requires explicit confirmation to execute.');
  }

  const userExecLockKey = `workflow:active_execution:${userId}`;
  let userSemaphoreAcquired = false;
  try {
    const userLock = await redis.set(userExecLockKey, planId, 'EX', 90, 'NX');
    if (!userLock) {
      throw new ApiError(429, 'Another workflow is already actively executing for your account. Please wait for it to complete.');
    }
    userSemaphoreAcquired = true;
  } catch (err) {
    if (err instanceof ApiError) throw err;
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
    const compensationStack: Array<{ type: 'TEAM' | 'PROJECT' | 'DOCUMENT' | 'CALENDAR_EVENT' | 'TASK' | 'WHITEBOARD'; id: string }> = [];
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
      const userOrg = await getUserOrganizationContext(userId, undefined, plan.summary);
      orgId = userOrg?.organizationId;
    }

    const planStartTime = Date.now();
    const maxPlanDurationMs = 90000;

    for (const step of plan.steps) {
      if (Date.now() - planStartTime > maxPlanDurationMs) {
        throw new ApiError(504, 'Overall workflow execution deadline exceeded (90 seconds limit)');
      }
      const existingSuccess = results.find((r) => r.step === step.step && r.success);
      if (existingSuccess) {
        continue;
      }
      results = results.filter((r) => r.step !== step.step);
      let createdTeamId: string | undefined;

      try {
        await executeWithTimeout(
          (async () => {
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
          let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          if (!targetOrgId && resolvedParams.organizationName) {
            const orgCtx = await getUserOrganizationContext(userId, undefined, String(resolvedParams.organizationName).trim());
            targetOrgId = orgCtx?.organizationId;
          }
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
              await enforceHourlyVelocityQuota(userId, 'team', 5);
              team = await createTeam(targetOrgId, userId, {
                name: teamName,
                description: teamDesc,
              });
              createdTeamId = team.id;
              compensationStack.push({ type: 'TEAM', id: team.id });
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
        } else if (step.action === 'ADD_TEAM_MEMBER') {
          let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          if (!targetOrgId && resolvedParams.organizationName) {
            const orgCtx = await getUserOrganizationContext(userId, undefined, String(resolvedParams.organizationName).trim());
            targetOrgId = orgCtx?.organizationId;
          }

          let team: any = null;
          if (resolvedParams.teamId) {
            team = await prisma.team.findUnique({
              where: { id: String(resolvedParams.teamId).trim() },
              select: { id: true, name: true, organizationId: true },
            });
          }
          if (!team && resolvedParams.teamName) {
            const teamQuery = String(resolvedParams.teamName).trim();
            team = await prisma.team.findFirst({
              where: {
                ...(targetOrgId ? { organizationId: targetOrgId } : {}),
                name: { contains: teamQuery, mode: 'insensitive' },
              },
              select: { id: true, name: true, organizationId: true },
            });
          }

          if (!team) {
            throw new ApiError(404, `Team '${resolvedParams.teamName || 'specified'}' not found`);
          }

          if (plan.organizationId && team.organizationId && team.organizationId !== plan.organizationId) {
            throw new ApiError(403, 'Cross-organization operation blocked: Target team belongs to another organization');
          }

          const finalOrgId = String(team.organizationId || targetOrgId || '').trim();
          if (!finalOrgId) {
            throw new ApiError(400, 'Organization ID is required to add team members');
          }
          targetOrgId = finalOrgId;
          const callerOrg = await getUserOrganizationContext(userId, finalOrgId);
          if (!callerOrg) {
            throw new ApiError(403, 'You are not a member of this organization');
          }

          const callerRole = callerOrg.userRole;
          const isLeadOrAdmin = callerOrg.isOwner || callerRole === OrgRole.ORG_ADMIN;
          let isTeamLead = false;
          if (!isLeadOrAdmin) {
            const callerTeamMembership = await prisma.teamMember.findUnique({
              where: {
                teamId_userId: {
                  teamId: team.id,
                  userId,
                },
              },
            });
            if (callerTeamMembership?.role === 'LEAD') {
              isTeamLead = true;
            }
          }

          if (!isLeadOrAdmin && !isTeamLead) {
            throw new ApiError(403, 'You are not an admin or team head so you cannot add members to this team');
          }

          let targetMemberIds: string[] = [];
          if (Array.isArray(resolvedParams.memberIds)) {
            targetMemberIds = resolvedParams.memberIds.map(String);
          } else if (resolvedParams.memberId) {
            targetMemberIds = [String(resolvedParams.memberId).trim()];
          }

          if (targetMemberIds.length === 0 && resolvedParams.memberName) {
            const memberQuery = String(resolvedParams.memberName).trim();
            const matchedOrgMember = await prisma.organizationMember.findFirst({
              where: {
                organizationId: finalOrgId,
                user: {
                  name: { contains: memberQuery, mode: 'insensitive' },
                },
              },
              select: { userId: true },
            });
            if (matchedOrgMember) {
              targetMemberIds.push(matchedOrgMember.userId);
            }
          }

          if (targetMemberIds.length === 0) {
            throw new ApiError(400, 'Member to add could not be found or was not specified');
          }

          let addedCount = 0;
          for (const targetId of targetMemberIds) {
            await addTeamMember(finalOrgId, team.id, userId, callerRole, targetId, 'member');
            addedCount++;
          }

          results.push({
            step: step.step,
            action: 'ADD_TEAM_MEMBER',
            description: step.description,
            success: true,
            resource: {
              teamId: team.id,
              teamName: team.name,
              organizationId: targetOrgId,
              addedMembersCount: addedCount,
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

          if (targetTeamId) {
            const teamMembership = await prisma.teamMember.findUnique({
              where: {
                teamId_userId: {
                  teamId: targetTeamId,
                  userId,
                },
              },
            });
            if (!teamMembership) {
              const callerOrg = orgId ? await getUserOrganizationContext(userId, orgId) : null;
              if (!callerOrg?.isOwner && callerOrg?.userRole !== OrgRole.ORG_ADMIN) {
                throw new ApiError(403, 'You must be a member of the team to schedule a team meeting');
              }
            }
          }

          startTime = await checkAndAdjustMeetingConflict(userId, startTime, durationMinutes || 60);

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

          if (userIds.length > 25) {
            userIds.length = 25;
          }

          let validRecipients: { id: string }[] = [];
          if (orgId) {
            const callerOrg = await getUserOrganizationContext(userId, orgId);
            if (!callerOrg) {
              throw new ApiError(403, 'You are not a member of the target organization');
            }

            const isOrgAdminOrOwner = callerOrg.isOwner || callerOrg.userRole === OrgRole.ORG_ADMIN;
            if (!isOrgAdminOrOwner && userIds.length > 50) {
              throw new ApiError(403, 'Non-admin users can notify at most 50 members at a time');
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
            if (userIds.length > 50) {
              throw new ApiError(403, 'Non-admin users can notify at most 50 members at a time');
            }
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
          const postContent = sanitizeWorkflowText(String(resolvedParams.content || resolvedParams.message || '')).trim();

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
          const content = sanitizeWorkflowText(String(resolvedParams.content || resolvedParams.message || '')).trim();
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

          const spamHash = crypto.createHash('md5').update(`${userId}:${targetConvId}:${content}`).digest('hex');
          const spamKey = `workflow:antispam:${spamHash}`;
          const isAllowed = await redis.set(spamKey, '1', 'EX', 30, 'NX');
          if (!isAllowed) {
            throw new ApiError(429, 'Anti-spam guard: Duplicate chat message detected for this conversation within 30 seconds');
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
        } else if (step.action === 'CREATE_DOCUMENT') {
          const title = sanitizeWorkflowText(String(resolvedParams.title || resolvedParams.documentName || resolvedParams.name || 'Untitled Document')).trim();
          if (!title) {
            throw new ApiError(400, 'Document title is required');
          }

          let scopeType = (resolvedParams.scopeType ? String(resolvedParams.scopeType).toUpperCase() : 'PERSONAL') as DocumentScopeType;
          if (!['PERSONAL', 'ORGANIZATION', 'TEAM', 'PROJECT'].includes(scopeType)) {
            scopeType = DocumentScopeType.PERSONAL;
          }

          let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          let targetTeamId = resolvedParams.teamId ? String(resolvedParams.teamId).trim() : undefined;
          let targetProjectId = resolvedParams.projectId ? String(resolvedParams.projectId).trim() : undefined;

          if (scopeType === DocumentScopeType.ORGANIZATION && !targetOrgId) {
            if (resolvedParams.organizationName) {
              const orgCtx = await getUserOrganizationContext(userId, undefined, String(resolvedParams.organizationName).trim());
              targetOrgId = orgCtx?.organizationId;
            }
          }

          if (scopeType === DocumentScopeType.TEAM && !targetTeamId) {
            if (resolvedParams.teamName) {
              const teamQuery = String(resolvedParams.teamName).trim();
              const team = await prisma.team.findFirst({
                where: {
                  ...(targetOrgId ? { organizationId: targetOrgId } : {}),
                  name: { contains: teamQuery, mode: 'insensitive' },
                },
                select: { id: true, organizationId: true },
              });
              if (team) {
                targetTeamId = team.id;
                targetOrgId = team.organizationId;
              }
            }
          }

          if (scopeType === DocumentScopeType.PROJECT && !targetProjectId) {
            if (resolvedParams.projectName) {
              const projQuery = String(resolvedParams.projectName).trim();
              const proj = await prisma.project.findFirst({
                where: {
                  name: { contains: projQuery, mode: 'insensitive' },
                  OR: [{ members: { some: { userId } } }, { createdById: userId }],
                },
                select: { id: true, organizationId: true },
              });
              if (proj) {
                targetProjectId = proj.id;
                if (proj.organizationId) {
                  targetOrgId = proj.organizationId;
                }
              }
            }
          }

          if (scopeType === DocumentScopeType.PERSONAL) {
            targetOrgId = undefined;
            targetTeamId = undefined;
            targetProjectId = undefined;
          }

          const rawContent = resolvedParams.content;
          const content = typeof rawContent === 'string'
            ? {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: sanitizeWorkflowText(rawContent) }],
                  },
                ],
              }
            : (rawContent || { type: 'doc', content: [{ type: 'paragraph' }] });

          await enforceHourlyVelocityQuota(userId, 'document', 20);
          const document = await createDocument(userId, {
            title,
            content,
            scopeType,
            organizationId: targetOrgId,
            teamId: targetTeamId,
            projectId: targetProjectId,
          });

          compensationStack.push({ type: 'DOCUMENT', id: document.id });

          variables.set(`$step${step.step}.documentId`, document.id);
          variables.set(`$step${step.step}.id`, document.id);
          variables.set(`$step${step.step}.title`, document.title);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              documentId: document.id,
              title: document.title,
              scopeType: document.scopeType,
              organizationId: document.organizationId,
              teamId: document.teamId,
              projectId: document.projectId,
            },
          });
        } else if (step.action === 'CREATE_TASK' || step.action === 'ASSIGN_TASK') {
          const taskTitle = sanitizeWorkflowText(String(resolvedParams.title || resolvedParams.name || '')).trim();
          if (!taskTitle) {
            throw new ApiError(400, 'Task title is required');
          }

          let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          let team: any = null;
          if (resolvedParams.teamId) {
            team = await prisma.team.findUnique({
              where: { id: String(resolvedParams.teamId).trim() },
              select: { id: true, name: true, organizationId: true },
            });
          }
          if (!team && resolvedParams.teamName) {
            const teamQuery = String(resolvedParams.teamName).trim();
            team = await prisma.team.findFirst({
              where: {
                ...(targetOrgId ? { organizationId: targetOrgId } : {}),
                name: { contains: teamQuery, mode: 'insensitive' },
              },
              select: { id: true, name: true, organizationId: true },
            });
          }

          if (!team) {
            const userTeam = await prisma.teamMember.findFirst({
              where: { userId },
              select: {
                team: {
                  select: { id: true, name: true, organizationId: true },
                },
              },
            });
            if (userTeam) {
              team = userTeam.team;
            }
          }

          if (!team) {
            throw new ApiError(404, `Team '${resolvedParams.teamName || 'specified'}' not found to assign task`);
          }

          if (plan.organizationId && team.organizationId && team.organizationId !== plan.organizationId) {
            throw new ApiError(403, 'Cross-organization operation blocked: Target team belongs to another organization');
          }

          targetOrgId = team.organizationId || targetOrgId;
          if (!targetOrgId) {
            throw new ApiError(400, 'Organization ID is required to create a task');
          }

          const callerOrg = await getUserOrganizationContext(userId, targetOrgId);
          if (!callerOrg) {
            throw new ApiError(403, 'You are not a member of the task organization');
          }

          let assigneeId = resolvedParams.assigneeId ? String(resolvedParams.assigneeId).trim() : undefined;
          if (!assigneeId && resolvedParams.assigneeName) {
            const assigneeQuery = String(resolvedParams.assigneeName).trim();
            const matchedTeamMember = await prisma.teamMember.findFirst({
              where: {
                teamId: team.id,
                user: {
                  name: { contains: assigneeQuery, mode: 'insensitive' },
                },
              },
              select: { userId: true },
            });
            if (matchedTeamMember) {
              assigneeId = matchedTeamMember.userId;
            } else {
              const matchedOrgUser = await prisma.organizationMember.findFirst({
                where: {
                  organizationId: targetOrgId,
                  user: {
                    name: { contains: assigneeQuery, mode: 'insensitive' },
                  },
                },
                select: { userId: true },
              });
              if (matchedOrgUser) {
                assigneeId = matchedOrgUser.userId;
              }
            }
          }

          if (!assigneeId) {
            assigneeId = userId;
          }

          const isAssigneeInTeam = await prisma.teamMember.findUnique({
            where: {
              teamId_userId: {
                teamId: team.id,
                userId: assigneeId,
              },
            },
          });

          if (!isAssigneeInTeam) {
            throw new ApiError(400, 'Assignee must be a member of this specific team');
          }

          let taskDueDate = resolvedParams.dueDate ? String(resolvedParams.dueDate).trim() : undefined;
          if (taskDueDate) {
            const parsedDue = new Date(taskDueDate);
            if (!isNaN(parsedDue.getTime()) && parsedDue.getTime() < Date.now() - 60000) {
              const adjusted = new Date();
              adjusted.setHours(parsedDue.getHours(), parsedDue.getMinutes(), 0, 0);
              if (adjusted.getTime() < Date.now()) {
                adjusted.setDate(adjusted.getDate() + 1);
              }
              taskDueDate = adjusted.toISOString();
            }
          }

          const task = await createTask(
            targetOrgId,
            team.id,
            userId,
            callerOrg.isOwner ? OrgRole.ORG_ADMIN : callerOrg.userRole,
            {
              title: taskTitle,
              description: resolvedParams.description ? sanitizeWorkflowText(String(resolvedParams.description)).trim() : undefined,
              dueDate: taskDueDate,
              assigneeId,
            }
          );

          compensationStack.push({ type: 'TASK', id: task.id });

          variables.set(`$step${step.step}.taskId`, task.id);
          variables.set(`$step${step.step}.id`, task.id);
          variables.set(`$step${step.step}.title`, task.title);

          results.push({
            step: step.step,
            action: 'CREATE_TASK',
            description: step.description,
            success: true,
            resource: {
              taskId: task.id,
              title: task.title,
              teamId: team.id,
              teamName: team.name,
              assigneeId: task.assigneeId,
              status: task.status,
            },
          });
        } else if (step.action === 'CREATE_PROJECT') {
          const projectName = String(resolvedParams.name || resolvedParams.title || '').trim();
          if (!projectName || projectName.length < 2) {
            throw new ApiError(400, 'Project name must be at least 2 characters');
          }

          let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          if (!targetOrgId && resolvedParams.organizationName) {
            const orgCtx = await getUserOrganizationContext(userId, undefined, String(resolvedParams.organizationName).trim());
            targetOrgId = orgCtx?.organizationId;
          }

          if (!targetOrgId) {
            const userOrg = await prisma.organizationMember.findFirst({
              where: { userId },
              select: { organizationId: true },
            });
            targetOrgId = userOrg?.organizationId;
          }

          if (!targetOrgId) {
            throw new ApiError(400, 'An organization is required to create a project');
          }

          const callerOrg = await getUserOrganizationContext(userId, targetOrgId);
          if (!callerOrg) {
            throw new ApiError(403, 'You are not a member of this organization');
          }

          const canCreate = callerOrg.isOwner || callerOrg.userRole === OrgRole.ORG_ADMIN || callerOrg.userRole === OrgRole.TEAM_HEAD;
          if (!canCreate) {
            throw new ApiError(403, 'Only organization owners, admins, or team leads can create projects');
          }

          const rawBudget = resolvedParams.budget;
          const budget = rawBudget !== undefined && rawBudget !== null && !isNaN(Number(rawBudget)) ? Number(rawBudget) : undefined;

          let projectDueDate = resolvedParams.dueDate ? String(resolvedParams.dueDate).trim() : undefined;
          if (projectDueDate) {
            const parsedDue = new Date(projectDueDate);
            if (!isNaN(parsedDue.getTime()) && parsedDue.getTime() < Date.now() - 60000) {
              const adjusted = new Date();
              adjusted.setHours(parsedDue.getHours(), parsedDue.getMinutes(), 0, 0);
              if (adjusted.getTime() < Date.now()) {
                adjusted.setDate(adjusted.getDate() + 1);
              }
              projectDueDate = adjusted.toISOString();
            }
          }

          await enforceHourlyVelocityQuota(userId, 'project', 10);
          const project = await createProject(userId, targetOrgId, {
            name: projectName,
            description: resolvedParams.description ? String(resolvedParams.description).trim() : undefined,
            budget,
            dueDate: projectDueDate,
          });

          compensationStack.push({ type: 'PROJECT', id: project.id });

          variables.set(`$step${step.step}.projectId`, project.id);
          variables.set(`$step${step.step}.id`, project.id);
          variables.set(`$step${step.step}.name`, project.name);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              projectId: project.id,
              name: project.name,
              organizationId: targetOrgId,
              status: project.status,
            },
          });
        } else if (step.action === 'INVITE_ORG_MEMBER') {
          let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          if (!targetOrgId && resolvedParams.organizationName) {
            const orgCtx = await getUserOrganizationContext(userId, undefined, String(resolvedParams.organizationName).trim());
            targetOrgId = orgCtx?.organizationId;
          }

          if (!targetOrgId) {
            throw new ApiError(400, 'Organization ID is required to invite an organization member');
          }

          const callerOrg = await getUserOrganizationContext(userId, targetOrgId);
          if (!callerOrg) {
            throw new ApiError(403, 'You are not a member of this organization');
          }

          if (!callerOrg.isOwner && callerOrg.userRole !== OrgRole.ORG_ADMIN) {
            throw new ApiError(403, 'Only organization owners and admins can invite members to the organization');
          }

          if (resolvedParams.role === 'ORG_ADMIN' && !callerOrg.isOwner) {
            throw new ApiError(403, 'Only the organization owner can invite organization admins');
          }

          let email = resolvedParams.email ? String(resolvedParams.email).trim().toLowerCase() : undefined;
          if (email) {
            validateSafeUrlAndDomain(email);
          }
          if (!email && resolvedParams.memberName) {
            const queryName = String(resolvedParams.memberName).trim();
            const matchedUser = await prisma.user.findFirst({
              where: {
                name: { contains: queryName, mode: 'insensitive' },
              },
              select: { email: true, id: true },
            });
            if (matchedUser) {
              email = matchedUser.email.toLowerCase();
            }
          }

          if (!email) {
            throw new ApiError(400, 'Member email is required to invite to organization');
          }

          const inviteResult = await createOrganizationInvite(targetOrgId, userId, {
            email,
            role: resolvedParams.role === 'ORG_ADMIN' ? OrgRole.ORG_ADMIN : OrgRole.MEMBER,
            teamId: resolvedParams.teamId ? String(resolvedParams.teamId).trim() : undefined,
            teamRole: resolvedParams.teamRole ? resolvedParams.teamRole : undefined,
          });

          const inviteId = (inviteResult as any)?.id || (inviteResult as any)?.invite?.id || '';
          if (inviteId) {
            variables.set(`$step${step.step}.inviteId`, inviteId);
            variables.set(`$step${step.step}.id`, inviteId);
          }
          variables.set(`$step${step.step}.email`, email);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              organizationId: targetOrgId,
              email,
              invite: inviteResult,
            },
          });
        } else if (step.action === 'REMOVE_TEAM_MEMBER') {
          let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          if (!targetOrgId && resolvedParams.organizationName) {
            const orgCtx = await getUserOrganizationContext(userId, undefined, String(resolvedParams.organizationName).trim());
            targetOrgId = orgCtx?.organizationId;
          }

          let team: any = null;
          if (resolvedParams.teamId) {
            team = await prisma.team.findUnique({
              where: { id: String(resolvedParams.teamId).trim() },
              select: { id: true, name: true, organizationId: true },
            });
          }
          if (!team && resolvedParams.teamName) {
            const teamQuery = String(resolvedParams.teamName).trim();
            team = await prisma.team.findFirst({
              where: {
                ...(targetOrgId ? { organizationId: targetOrgId } : {}),
                name: { contains: teamQuery, mode: 'insensitive' },
              },
              select: { id: true, name: true, organizationId: true },
            });
          }

          if (!team) {
            throw new ApiError(404, `Team '${resolvedParams.teamName || 'specified'}' not found`);
          }

          if (plan.organizationId && team.organizationId && team.organizationId !== plan.organizationId) {
            throw new ApiError(403, 'Cross-organization operation blocked: Target team belongs to another organization');
          }

          const finalOrgId = String(team.organizationId || targetOrgId || '').trim();
          if (!finalOrgId) {
            throw new ApiError(400, 'Organization ID is required to remove team member');
          }

          const callerOrg = await getUserOrganizationContext(userId, finalOrgId);
          if (!callerOrg) {
            throw new ApiError(403, 'You are not a member of this organization');
          }

          const callerRole = callerOrg.isOwner ? OrgRole.ORG_ADMIN : callerOrg.userRole;

          let targetUserId = resolvedParams.memberId || resolvedParams.userId || resolvedParams.targetUserId
            ? String(resolvedParams.memberId || resolvedParams.userId || resolvedParams.targetUserId).trim()
            : undefined;

          if (!targetUserId && resolvedParams.memberName) {
            const memberQuery = String(resolvedParams.memberName).trim();
            const matchedTeamMember = await prisma.teamMember.findFirst({
              where: {
                teamId: team.id,
                user: {
                  name: { contains: memberQuery, mode: 'insensitive' },
                },
              },
              select: { userId: true },
            });
            if (matchedTeamMember) {
              targetUserId = matchedTeamMember.userId;
            }
          }

          if (!targetUserId && resolvedParams.memberEmail) {
            const emailQuery = String(resolvedParams.memberEmail).trim().toLowerCase();
            const matchedTeamMember = await prisma.teamMember.findFirst({
              where: {
                teamId: team.id,
                user: {
                  email: { equals: emailQuery, mode: 'insensitive' },
                },
              },
              select: { userId: true },
            });
            if (matchedTeamMember) {
              targetUserId = matchedTeamMember.userId;
            }
          }

          if (!targetUserId) {
            throw new ApiError(404, `Member '${resolvedParams.memberName || resolvedParams.memberEmail || 'specified'}' not found in team '${team.name}'`);
          }

          if (targetUserId === userId) {
            throw new ApiError(400, 'Cannot remove yourself via workflow action');
          }

          const org = await prisma.organization.findUnique({
            where: { id: finalOrgId },
            select: { ownerId: true },
          });

          if (org?.ownerId === targetUserId) {
            throw new ApiError(400, 'Cannot remove the organization owner');
          }

          const targetOrgMember = await prisma.organizationMember.findUnique({
            where: {
              organizationId_userId: {
                organizationId: finalOrgId,
                userId: targetUserId,
              },
            },
          });

          if (targetOrgMember?.role === OrgRole.ORG_ADMIN) {
            const adminCount = await prisma.organizationMember.count({
              where: {
                organizationId: finalOrgId,
                role: OrgRole.ORG_ADMIN,
              },
            });
            if (adminCount <= 1) {
              throw new ApiError(400, 'Cannot remove the last remaining organization admin');
            }
          }

          await removeTeamMember(finalOrgId, team.id, userId, callerRole, targetUserId);

          variables.set(`$step${step.step}.removedUserId`, targetUserId);
          variables.set(`$step${step.step}.teamId`, team.id);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              teamId: team.id,
              teamName: team.name,
              removedUserId: targetUserId,
              organizationId: finalOrgId,
            },
          });
        } else if (step.action === 'CREATE_WHITEBOARD') {
          const boardName = String(resolvedParams.name || resolvedParams.title || 'Untitled Whiteboard').trim();
          let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          if (!targetOrgId && resolvedParams.organizationName) {
            const orgCtx = await getUserOrganizationContext(userId, undefined, String(resolvedParams.organizationName).trim());
            targetOrgId = orgCtx?.organizationId;
          }

          const whiteboard = await createWhiteboard(userId, {
            name: boardName,
            organizationId: targetOrgId,
            meetingId: resolvedParams.meetingId ? String(resolvedParams.meetingId).trim() : undefined,
            content: resolvedParams.content,
          });

          compensationStack.push({ type: 'WHITEBOARD', id: whiteboard.id });

          variables.set(`$step${step.step}.whiteboardId`, whiteboard.id);
          variables.set(`$step${step.step}.id`, whiteboard.id);
          variables.set(`$step${step.step}.name`, whiteboard.name);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              whiteboardId: whiteboard.id,
              name: whiteboard.name,
              organizationId: whiteboard.organizationId,
            },
          });
        } else if (step.action === 'CREATE_POLL') {
          const pollQuestion = String(resolvedParams.question || resolvedParams.title || '').trim();
          if (!pollQuestion) {
            throw new ApiError(400, 'Poll question is required');
          }

          let rawOptions = resolvedParams.options;
          if (typeof rawOptions === 'string') {
            try {
              rawOptions = JSON.parse(rawOptions);
            } catch {
              rawOptions = rawOptions.split(',').map((s: string) => s.trim());
            }
          }

          if (!Array.isArray(rawOptions) || rawOptions.length < 2) {
            throw new ApiError(400, 'Poll must have at least 2 options');
          }

          const pollOptions = rawOptions.map((o: any) => String(o).trim()).filter((o: string) => o.length > 0);
          if (pollOptions.length < 2) {
            throw new ApiError(400, 'Poll must have at least 2 valid non-empty options');
          }

          let targetConvId: string | undefined = resolvedParams.conversationId
            ? String(resolvedParams.conversationId).trim()
            : undefined;

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.teamId) {
            const teamConv = await prisma.conversation.findFirst({
              where: { teamId: String(resolvedParams.teamId).trim() },
              select: { id: true },
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
                name: { contains: queryName, mode: 'insensitive' },
              },
              select: { id: true },
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
                name: { contains: queryGroup, mode: 'insensitive' },
              },
              select: { id: true },
            });
            if (matchingConv) {
              targetConvId = matchingConv.id;
            } else {
              const team = await prisma.team.findFirst({
                where: {
                  name: { contains: queryGroup, mode: 'insensitive' },
                  members: { some: { userId } },
                },
                select: { id: true },
              });
              if (team) {
                const teamConv = await prisma.conversation.findFirst({
                  where: { teamId: team.id },
                  select: { id: true },
                });
                if (teamConv) {
                  targetConvId = teamConv.id;
                }
              }
            }
          }

          if (!targetConvId || targetConvId.startsWith('$')) {
            throw new ApiError(404, `Could not find recipient or group conversation for '${resolvedParams.recipientName || resolvedParams.groupName || 'poll'}'`);
          }

          const { message, participants } = await saveMessage(
            userId,
            targetConvId,
            resolvedParams.content || resolvedParams.message || '',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
              question: pollQuestion,
              options: pollOptions,
              allowMultipleAnswers: Boolean(resolvedParams.allowMultipleAnswers),
            }
          );

          try {
            const io = getIO();
            const conversationRooms = [`conversation:${message.conversationId}`];
            io.to(conversationRooms).emit(CHAT_EVENTS.MESSAGE_NEW, message);
            participants.forEach((p) => {
              io.to(`user:${p.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
                conversationId: message.conversationId,
                lastMessage: message,
              });
            });

            const recipientUserIds = participants
              .filter((p) => p.userId !== userId)
              .map((p) => p.userId);

            if (recipientUserIds.length > 0) {
              const sender = await prisma.user.findUnique({
                where: { id: userId },
                select: { name: true },
              });
              sendPushToOfflineUsers(
                recipientUserIds,
                sender?.name || 'New Poll',
                `Poll: ${pollQuestion}`,
                {
                  type: 'NEW_MESSAGE',
                  conversationId: message.conversationId,
                  messageId: message.id,
                },
                {
                  tag: `chat_${message.conversationId}`,
                  channelId: 'quorum_chat_messages',
                  sound: 'default',
                }
              ).catch((pushErr) => {
                logger.warn('Failed to send push notification for poll message', pushErr);
              });
            }
          } catch (emitErr) {
            logger.warn('Failed to dispatch poll chat socket events', emitErr);
          }

          variables.set(`$step${step.step}.pollId`, message.id);
          variables.set(`$step${step.step}.messageId`, message.id);
          variables.set(`$step${step.step}.id`, message.id);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              messageId: message.id,
              conversationId: message.conversationId,
              question: pollQuestion,
              options: pollOptions,
            },
          });
        } else if (step.action === 'INVITE_COMMUNITY_MEMBER') {
          let targetCommunityId = resolvedParams.communityId ? String(resolvedParams.communityId).trim() : undefined;
          if ((!targetCommunityId || targetCommunityId.startsWith('$')) && resolvedParams.communityName) {
            const queryName = String(resolvedParams.communityName).trim();
            const communityRecord = await prisma.community.findFirst({
              where: {
                name: { equals: queryName, mode: 'insensitive' },
              },
              select: { id: true },
            });
            if (communityRecord) {
              targetCommunityId = communityRecord.id;
            } else {
              const partialComm = await prisma.community.findFirst({
                where: {
                  name: { contains: queryName, mode: 'insensitive' },
                },
                select: { id: true },
              });
              if (partialComm) {
                targetCommunityId = partialComm.id;
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
            throw new ApiError(404, `Target community '${resolvedParams.communityName || ''}' not found`);
          }

          const callerMembership = await prisma.communityMember.findUnique({
            where: {
              communityId_userId: {
                communityId: targetCommunityId,
                userId,
              },
            },
          });

          if (!callerMembership || (callerMembership.role !== 'OWNER' && callerMembership.role !== 'ADMIN')) {
            throw new ApiError(403, 'Only community owners and admins can invite members to this community');
          }

          let targetUserId = resolvedParams.userId || resolvedParams.targetUserId || resolvedParams.memberId
            ? String(resolvedParams.userId || resolvedParams.targetUserId || resolvedParams.memberId).trim()
            : undefined;
          let targetEmail = resolvedParams.email
            ? String(resolvedParams.email).trim().toLowerCase()
            : undefined;

          if (!targetUserId && !targetEmail && resolvedParams.memberName) {
            const queryName = String(resolvedParams.memberName).trim();
            const matchedUser = await prisma.user.findFirst({
              where: {
                name: { contains: queryName, mode: 'insensitive' },
              },
              select: { id: true, email: true },
            });
            if (matchedUser) {
              targetUserId = matchedUser.id;
              targetEmail = matchedUser.email.toLowerCase();
            }
          }

          if (!targetUserId && !targetEmail) {
            throw new ApiError(400, 'User ID, member name, or email is required to invite to community');
          }

          if (targetUserId && targetUserId === userId) {
            throw new ApiError(400, 'You cannot invite yourself to the community');
          }

          const inviteResult = await inviteUserToCommunity(userId, targetCommunityId, {
            userId: targetUserId,
            email: targetEmail,
            role: resolvedParams.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
            expiresInDays: resolvedParams.expiresInDays ? Number(resolvedParams.expiresInDays) : 7,
          });

          const inviteId = (inviteResult as any)?.id || (inviteResult as any)?.invite?.id || '';
          if (inviteId) {
            variables.set(`$step${step.step}.inviteId`, inviteId);
            variables.set(`$step${step.step}.id`, inviteId);
          }
          variables.set(`$step${step.step}.communityId`, targetCommunityId);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              communityId: targetCommunityId,
              invitedUserId: targetUserId,
              email: targetEmail,
              invite: inviteResult,
            },
          });
        } else if (step.action === 'REMOVE_COMMUNITY_MEMBER') {
          let targetCommunityId = resolvedParams.communityId ? String(resolvedParams.communityId).trim() : undefined;
          if ((!targetCommunityId || targetCommunityId.startsWith('$')) && resolvedParams.communityName) {
            const queryName = String(resolvedParams.communityName).trim();
            const communityRecord = await prisma.community.findFirst({
              where: {
                name: { equals: queryName, mode: 'insensitive' },
              },
              select: { id: true },
            });
            if (communityRecord) {
              targetCommunityId = communityRecord.id;
            } else {
              const partialComm = await prisma.community.findFirst({
                where: {
                  name: { contains: queryName, mode: 'insensitive' },
                },
                select: { id: true },
              });
              if (partialComm) {
                targetCommunityId = partialComm.id;
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
            throw new ApiError(404, `Target community '${resolvedParams.communityName || ''}' not found`);
          }

          const callerMembership = await prisma.communityMember.findUnique({
            where: {
              communityId_userId: {
                communityId: targetCommunityId,
                userId,
              },
            },
          });

          if (!callerMembership || (callerMembership.role !== 'OWNER' && callerMembership.role !== 'ADMIN')) {
            throw new ApiError(403, 'Only community owners and admins can remove members from this community');
          }

          let targetUserId = resolvedParams.targetUserId || resolvedParams.userId || resolvedParams.memberId
            ? String(resolvedParams.targetUserId || resolvedParams.userId || resolvedParams.memberId).trim()
            : undefined;

          if (!targetUserId && resolvedParams.memberName) {
            const memberQuery = String(resolvedParams.memberName).trim();
            const matchedMember = await prisma.communityMember.findFirst({
              where: {
                communityId: targetCommunityId,
                user: {
                  name: { contains: memberQuery, mode: 'insensitive' },
                },
              },
              select: { userId: true },
            });
            if (matchedMember) {
              targetUserId = matchedMember.userId;
            }
          }

          if (!targetUserId && resolvedParams.memberEmail) {
            const emailQuery = String(resolvedParams.memberEmail).trim().toLowerCase();
            const matchedMember = await prisma.communityMember.findFirst({
              where: {
                communityId: targetCommunityId,
                user: {
                  email: { equals: emailQuery, mode: 'insensitive' },
                },
              },
              select: { userId: true },
            });
            if (matchedMember) {
              targetUserId = matchedMember.userId;
            }
          }

          if (!targetUserId) {
            throw new ApiError(404, `Member '${resolvedParams.memberName || resolvedParams.memberEmail || 'specified'}' not found in community`);
          }

          if (targetUserId === userId) {
            throw new ApiError(400, 'Cannot remove yourself via this command. Use leave community instead');
          }

          const targetCommMember = await prisma.communityMember.findUnique({
            where: {
              communityId_userId: {
                communityId: targetCommunityId,
                userId: targetUserId,
              },
            },
            select: { role: true },
          });

          if (targetCommMember?.role === 'OWNER') {
            throw new ApiError(400, 'Cannot remove the community owner');
          }

          await removeCommunityMember(userId, targetCommunityId, targetUserId);

          variables.set(`$step${step.step}.removedUserId`, targetUserId);
          variables.set(`$step${step.step}.communityId`, targetCommunityId);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              communityId: targetCommunityId,
              removedUserId: targetUserId,
            },
          });
        } else if (step.action === 'DELETE_CHAT_MESSAGE') {
          let messageId = resolvedParams.messageId ? String(resolvedParams.messageId).trim() : undefined;
          let targetConvId: string | undefined = resolvedParams.conversationId
            ? String(resolvedParams.conversationId).trim()
            : undefined;

          if (!targetConvId || targetConvId.startsWith('$')) {
            if (resolvedParams.teamId) {
              const teamConv = await prisma.conversation.findFirst({
                where: { teamId: String(resolvedParams.teamId).trim() },
                select: { id: true },
              });
              if (teamConv) {
                targetConvId = teamConv.id;
              }
            }
            if (!targetConvId && resolvedParams.recipientUserId) {
              const targetUserId = String(resolvedParams.recipientUserId).trim();
              if (targetUserId !== userId) {
                const directConv = await getOrCreateDirectConversation(userId, targetUserId);
                if (directConv) {
                  targetConvId = directConv.id;
                }
              }
            }
            if (!targetConvId && resolvedParams.recipientName) {
              const queryName = String(resolvedParams.recipientName).trim();
              const matchedUser = await prisma.user.findFirst({
                where: { name: { contains: queryName, mode: 'insensitive' } },
                select: { id: true },
              });
              if (matchedUser && matchedUser.id !== userId) {
                const directConv = await getOrCreateDirectConversation(userId, matchedUser.id);
                if (directConv) {
                  targetConvId = directConv.id;
                }
              }
            }
            if (!targetConvId && resolvedParams.groupName) {
              const queryGroup = String(resolvedParams.groupName).trim();
              const matchingConv = await prisma.conversation.findFirst({
                where: {
                  participants: { some: { userId } },
                  name: { contains: queryGroup, mode: 'insensitive' },
                },
                select: { id: true },
              });
              if (matchingConv) {
                targetConvId = matchingConv.id;
              }
            }
          }

          if (!messageId) {
            if (!targetConvId) {
              const lastUserMessage = await prisma.message.findFirst({
                where: {
                  senderId: userId,
                  isDeleted: false,
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true, conversationId: true },
              });
              if (lastUserMessage) {
                messageId = lastUserMessage.id;
                targetConvId = lastUserMessage.conversationId;
              }
            } else {
              const contentQuery = resolvedParams.contentQuery ? String(resolvedParams.contentQuery).trim() : undefined;
              const targetMessage = await prisma.message.findFirst({
                where: {
                  conversationId: targetConvId,
                  senderId: userId,
                  isDeleted: false,
                  ...(contentQuery ? { content: { contains: contentQuery, mode: 'insensitive' } } : {}),
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true },
              });
              if (targetMessage) {
                messageId = targetMessage.id;
              }
            }
          }

          if (!messageId || !targetConvId) {
            throw new ApiError(404, 'Could not find a matching message to delete');
          }

          const msg = await prisma.message.findUnique({
            where: { id: messageId },
            select: { senderId: true, conversationId: true },
          });

          if (!msg) {
            throw new ApiError(404, 'Message not found');
          }

          if (msg.senderId !== userId) {
            throw new ApiError(403, 'You do not have permission to delete another person\'s chat message');
          }

          const deleteForEveryone = resolvedParams.deleteForEveryone !== false;
          const deleteResult = await deleteMessage(userId, targetConvId, messageId, deleteForEveryone);

          variables.set(`$step${step.step}.deletedMessageId`, messageId);
          variables.set(`$step${step.step}.id`, messageId);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              messageId,
              conversationId: targetConvId,
              deleteForEveryone,
              result: deleteResult,
            },
          });
        } else if (step.action === 'DELETE_COMMUNITY_POST') {
          let postId = resolvedParams.postId ? String(resolvedParams.postId).trim() : undefined;

          if (!postId || postId.startsWith('$')) {
            let targetCommunityId = resolvedParams.communityId ? String(resolvedParams.communityId).trim() : undefined;
            if ((!targetCommunityId || targetCommunityId.startsWith('$')) && resolvedParams.communityName) {
              const queryName = String(resolvedParams.communityName).trim();
              const comm = await prisma.community.findFirst({
                where: { name: { contains: queryName, mode: 'insensitive' } },
                select: { id: true },
              });
              if (comm) {
                targetCommunityId = comm.id;
              }
            }

            const contentQuery = resolvedParams.contentQuery ? String(resolvedParams.contentQuery).trim() : undefined;
            const targetPost = await prisma.communityPost.findFirst({
              where: {
                authorId: userId,
                ...(targetCommunityId ? { communityId: targetCommunityId } : {}),
                ...(contentQuery ? { content: { contains: contentQuery, mode: 'insensitive' } } : {}),
              },
              orderBy: { createdAt: 'desc' },
              select: { id: true, communityId: true },
            });

            if (targetPost) {
              postId = targetPost.id;
            }
          }

          if (!postId) {
            throw new ApiError(404, `Could not find a post to delete in ${resolvedParams.communityName || 'the community'}`);
          }

          const post = await prisma.communityPost.findUnique({
            where: { id: postId },
            select: { authorId: true, communityId: true },
          });

          if (!post) {
            throw new ApiError(404, 'Community post not found');
          }

          if (post.authorId !== userId) {
            const callerMembership = await prisma.communityMember.findUnique({
              where: {
                communityId_userId: {
                  communityId: post.communityId,
                  userId,
                },
              },
              select: { role: true },
            });
            if (!callerMembership || (callerMembership.role !== 'OWNER' && callerMembership.role !== 'ADMIN')) {
              throw new ApiError(403, 'You do not have permission to delete another person\'s community post');
            }
          }

          const deleteResult = await deleteCommunityPost(userId, postId);

          variables.set(`$step${step.step}.deletedPostId`, postId);
          variables.set(`$step${step.step}.id`, postId);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              postId,
              result: deleteResult,
            },
          });
        } else if (step.action === 'START_VIDEO_CALL') {
          const callTitle = String(resolvedParams.title || 'Quick Sync Video Call').trim();
          let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
          let targetTeamId = resolvedParams.teamId ? String(resolvedParams.teamId).trim() : undefined;

          if (!targetOrgId && resolvedParams.organizationName) {
            const orgCtx = await getUserOrganizationContext(userId, undefined, String(resolvedParams.organizationName).trim());
            targetOrgId = orgCtx?.organizationId;
          }

          if (!targetTeamId && resolvedParams.teamName) {
            const teamQuery = String(resolvedParams.teamName).trim();
            const team = await prisma.team.findFirst({
              where: {
                ...(targetOrgId ? { organizationId: targetOrgId } : {}),
                name: { contains: teamQuery, mode: 'insensitive' },
              },
              select: { id: true, organizationId: true },
            });
            if (team) {
              targetTeamId = team.id;
              targetOrgId = team.organizationId;
            }
          }

          if (targetTeamId) {
            const teamMembership = await prisma.teamMember.findUnique({
              where: {
                teamId_userId: {
                  teamId: targetTeamId,
                  userId,
                },
              },
            });
            if (!teamMembership) {
              const callerOrg = targetOrgId ? await getUserOrganizationContext(userId, targetOrgId) : null;
              if (!callerOrg?.isOwner && callerOrg?.userRole !== OrgRole.ORG_ADMIN) {
                throw new ApiError(403, 'You must be a member of the team to start a team video call');
              }
            }
          }

          const durationMinutes = resolvedParams.durationMinutes !== undefined && resolvedParams.durationMinutes !== null
            ? Number(resolvedParams.durationMinutes)
            : 60;

          const scopeType = targetTeamId
            ? MeetingScopeType.TEAM
            : (targetOrgId ? MeetingScopeType.ORGANIZATION : MeetingScopeType.PERSONAL);

          const meeting = await createScopedMeeting(userId, {
            title: callTitle,
            scopeType,
            organizationId: targetOrgId,
            teamId: targetTeamId,
            durationMinutes,
          });

          const participantUserIds = new Set<string>();
          if (Array.isArray(resolvedParams.participantUserIds)) {
            resolvedParams.participantUserIds.forEach((id: any) => {
              if (id && String(id).trim() !== userId) {
                participantUserIds.add(String(id).trim());
              }
            });
          }

          if (Array.isArray(resolvedParams.participantNames)) {
            for (const rawName of resolvedParams.participantNames) {
              const nameQuery = String(rawName).trim();
              if (nameQuery) {
                const matchedUser = await prisma.user.findFirst({
                  where: {
                    name: { contains: nameQuery, mode: 'insensitive' },
                  },
                  select: { id: true },
                });
                if (matchedUser && matchedUser.id !== userId) {
                  participantUserIds.add(matchedUser.id);
                }
              }
            }
          }

          if (targetTeamId) {
            const teamMembers = await prisma.teamMember.findMany({
              where: { teamId: targetTeamId },
              select: { userId: true },
            });
            teamMembers.forEach((tm) => {
              if (tm.userId !== userId) {
                participantUserIds.add(tm.userId);
              }
            });
          }

          const recipientList = Array.from(participantUserIds).slice(0, 25);
          const hostUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
          });
          const hostName = hostUser?.name || 'A teammate';

          if (recipientList.length > 0) {
            try {
              const io = getIO();
              for (const targetId of recipientList) {
                io.to(`user:${targetId}`).emit('notification:new', {
                  type: 'MEETING_STARTED',
                  title: `Incoming Video Call: ${meeting.title}`,
                  body: `${hostName} started a video call. Click to join!`,
                  actorId: userId,
                  data: {
                    meetingCode: meeting.code,
                    meetingLink: meeting.link,
                  },
                  createdAt: new Date(),
                });
              }

              sendPushToOfflineUsers(
                recipientList,
                `Incoming Video Call: ${meeting.title}`,
                `${hostName} started a video call. Tap to join!`,
                {
                  type: 'MEETING_STARTED',
                  meetingCode: meeting.code,
                  meetingLink: meeting.link,
                },
                {
                  tag: `call_${meeting.code}`,
                  channelId: 'quorum_chat_messages',
                  sound: 'default',
                }
              ).catch((pushErr) => {
                logger.warn('Failed to send call push notification', pushErr);
              });
            } catch (notifyErr) {
              logger.warn('Failed to dispatch call socket/push notifications', notifyErr);
            }

            if (resolvedParams.sendChatMessage !== false) {
              const callChatMessage = `📞 Started a video call: ${meeting.title}\nJoin here: ${meeting.link}`;
              try {
                if (recipientList.length === 1) {
                  const directConv = await getOrCreateDirectConversation(userId, recipientList[0]);
                  if (directConv) {
                    await saveMessage(userId, directConv.id, callChatMessage);
                  }
                } else if (targetTeamId) {
                  const teamConv = await prisma.conversation.findFirst({
                    where: { teamId: targetTeamId },
                    select: { id: true },
                  });
                  if (teamConv) {
                    await saveMessage(userId, teamConv.id, callChatMessage);
                  }
                }
              } catch (chatErr) {
                logger.warn('Failed to send video call chat link message', chatErr);
              }
            }
          }

          variables.set(`$step${step.step}.meetingId`, meeting.code);
          variables.set(`$step${step.step}.meetingCode`, meeting.code);
          variables.set(`$step${step.step}.link`, meeting.link);
          variables.set(`$step${step.step}.id`, meeting.code);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              meetingCode: meeting.code,
              link: meeting.link,
              title: meeting.title,
              invitedParticipantsCount: recipientList.length,
              recipientList,
            },
          });
        } else if (step.action === 'UPDATE_TASK_STATUS' || step.action === 'COMPLETE_TASK') {
          let targetTaskId = resolvedParams.taskId ? String(resolvedParams.taskId).trim() : undefined;
          if ((!targetTaskId || targetTaskId.startsWith('$')) && resolvedParams.taskTitle) {
            const titleQuery = String(resolvedParams.taskTitle).trim();
            const matchedTask = await prisma.teamTask.findFirst({
              where: {
                title: { contains: titleQuery, mode: 'insensitive' },
                team: {
                  members: { some: { userId } },
                },
              },
              select: { id: true },
            });
            if (matchedTask) {
              targetTaskId = matchedTask.id;
            }
          }

          if (!targetTaskId || targetTaskId.startsWith('$')) {
            const userTask = await prisma.teamTask.findFirst({
              where: { assigneeId: userId },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            });
            targetTaskId = userTask?.id;
          }

          if (!targetTaskId) {
            throw new ApiError(404, `Task '${resolvedParams.taskTitle || 'specified'}' not found`);
          }

          const task = await prisma.teamTask.findUnique({
            where: { id: targetTaskId },
            include: { team: true },
          });

          if (!task) {
            throw new ApiError(404, 'Task not found');
          }

          let newStatus = String(resolvedParams.status || 'DONE').toUpperCase().trim();
          if (newStatus === 'COMPLETE' || newStatus === 'COMPLETED') {
            newStatus = 'DONE';
          }
          if (newStatus === 'INPROGRESS' || newStatus === 'IN_PROGRESS' || newStatus === 'IN PROGRESS') {
            newStatus = 'IN_PROGRESS';
          }
          if (newStatus !== 'TODO' && newStatus !== 'IN_PROGRESS' && newStatus !== 'DONE') {
            newStatus = 'DONE';
          }

          const userOrgMember = await prisma.organizationMember.findUnique({
            where: {
              organizationId_userId: {
                organizationId: task.team.organizationId,
                userId,
              },
            },
            select: { role: true },
          });
          const org = await prisma.organization.findUnique({
            where: { id: task.team.organizationId },
            select: { ownerId: true },
          });
          const isOwner = org?.ownerId === userId;
          const userRole = isOwner ? OrgRole.ORG_ADMIN : (userOrgMember?.role || OrgRole.MEMBER);

          const updatedTask = await updateTaskStatus(
            task.team.organizationId,
            task.teamId,
            task.id,
            userId,
            userRole,
            newStatus
          );

          variables.set(`$step${step.step}.taskId`, updatedTask.id);
          variables.set(`$step${step.step}.id`, updatedTask.id);
          variables.set(`$step${step.step}.status`, updatedTask.status);

          results.push({
            step: step.step,
            action: 'UPDATE_TASK_STATUS',
            description: step.description,
            success: true,
            resource: {
              taskId: updatedTask.id,
              title: updatedTask.title,
              teamId: updatedTask.teamId,
              status: updatedTask.status,
            },
          });
        } else if (step.action === 'CANCEL_MEETING') {
          let targetCode = resolvedParams.meetingCode || resolvedParams.code
            ? String(resolvedParams.meetingCode || resolvedParams.code).trim()
            : undefined;

          if ((!targetCode || targetCode.startsWith('$')) && resolvedParams.meetingTitle) {
            const titleQuery = String(resolvedParams.meetingTitle).trim();
            const matchedMeeting = await prisma.meeting.findFirst({
              where: {
                title: { contains: titleQuery, mode: 'insensitive' },
                hostId: userId,
                status: { not: 'CANCELLED' },
              },
              orderBy: { createdAt: 'desc' },
              select: { code: true },
            });
            if (matchedMeeting) {
              targetCode = matchedMeeting.code;
            }
          }

          if (!targetCode || targetCode.startsWith('$')) {
            const recentMeeting = await prisma.meeting.findFirst({
              where: {
                hostId: userId,
                status: { in: ['SCHEDULED', 'ACTIVE'] },
              },
              orderBy: { createdAt: 'desc' },
              select: { code: true },
            });
            targetCode = recentMeeting?.code;
          }

          if (!targetCode) {
            throw new ApiError(404, `Meeting '${resolvedParams.meetingTitle || 'specified'}' not found to cancel`);
          }

          const cancelResult = await cancelMeeting(targetCode, userId);

          variables.set(`$step${step.step}.meetingCode`, targetCode);
          variables.set(`$step${step.step}.id`, targetCode);

          results.push({
            step: step.step,
            action: step.action,
            description: step.description,
            success: true,
            resource: {
              meetingCode: targetCode,
              cancelled: true,
              result: cancelResult,
            },
          });
        } else if (step.action === 'PIN_CHAT_MESSAGE' || step.action === 'PIN_MESSAGE') {
          let targetConvId = resolvedParams.conversationId ? String(resolvedParams.conversationId).trim() : undefined;
          let targetMsgId = resolvedParams.messageId ? String(resolvedParams.messageId).trim() : undefined;

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.recipientUserId) {
            const targetUserId = String(resolvedParams.recipientUserId).trim();
            const directConv = await getOrCreateDirectConversation(userId, targetUserId);
            if (directConv) {
              targetConvId = directConv.id;
            }
          }

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.recipientName) {
            const queryName = String(resolvedParams.recipientName).trim();
            const matchedUser = await prisma.user.findFirst({
              where: {
                name: { contains: queryName, mode: 'insensitive' },
              },
              select: { id: true },
            });
            if (matchedUser && matchedUser.id !== userId) {
              const directConv = await getOrCreateDirectConversation(userId, matchedUser.id);
              if (directConv) {
                targetConvId = directConv.id;
              }
            }
          }

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.teamId) {
            const targetTeamId = String(resolvedParams.teamId).trim();
            const teamConv = await prisma.conversation.findFirst({
              where: { teamId: targetTeamId },
              select: { id: true },
            });
            if (teamConv) {
              targetConvId = teamConv.id;
            }
          }

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.groupName) {
            const queryGroup = String(resolvedParams.groupName).trim();
            const matchingConv = await prisma.conversation.findFirst({
              where: {
                participants: { some: { userId } },
                name: { contains: queryGroup, mode: 'insensitive' },
              },
              select: { id: true },
            });
            if (matchingConv) {
              targetConvId = matchingConv.id;
            } else {
              const team = await prisma.team.findFirst({
                where: {
                  name: { contains: queryGroup, mode: 'insensitive' },
                  members: { some: { userId } },
                },
                select: { id: true },
              });
              if (team) {
                const teamConv = await prisma.conversation.findFirst({
                  where: { teamId: team.id },
                  select: { id: true },
                });
                if (teamConv) {
                  targetConvId = teamConv.id;
                }
              }
            }
          }

          if (!targetMsgId || targetMsgId.startsWith('$')) {
            const contentQuery = resolvedParams.contentQuery ? String(resolvedParams.contentQuery).trim() : undefined;
            const messageWhere: any = {
              isDeleted: false,
              deletedAt: null,
            };
            if (targetConvId) {
              messageWhere.conversationId = targetConvId;
            } else {
              messageWhere.conversation = {
                participants: { some: { userId } },
              };
            }
            if (contentQuery) {
              messageWhere.content = { contains: contentQuery, mode: 'insensitive' };
            }

            const candidate = await prisma.message.findFirst({
              where: messageWhere,
              orderBy: { createdAt: 'desc' },
              select: { id: true, conversationId: true },
            });

            if (candidate) {
              targetMsgId = candidate.id;
              if (!targetConvId) {
                targetConvId = candidate.conversationId;
              }
            }
          }

          if (!targetConvId || !targetMsgId) {
            throw new ApiError(404, 'Could not identify conversation or message to pin');
          }

          const pinResult = await pinMessage(userId, targetConvId, targetMsgId);

          try {
            getIO().to(`conversation:${targetConvId}`).emit('message:pinned', {
              conversationId: targetConvId,
              messageId: targetMsgId,
              pinnedBy: userId,
            });
          } catch (emitErr) {
            logger.warn('Failed to emit message:pinned socket event', emitErr);
          }

          variables.set(`$step${step.step}.messageId`, targetMsgId);
          variables.set(`$step${step.step}.id`, targetMsgId);
          variables.set(`$step${step.step}.conversationId`, targetConvId);

          results.push({
            step: step.step,
            action: 'PIN_CHAT_MESSAGE',
            description: step.description,
            success: true,
            resource: {
              messageId: targetMsgId,
              conversationId: targetConvId,
              pinned: true,
              result: pinResult,
            },
          });
        } else if (step.action === 'ADD_PROJECT_MEMBER' || step.action === 'INVITE_PROJECT_MEMBER') {
          let targetProjectId = resolvedParams.projectId ? String(resolvedParams.projectId).trim() : undefined;
          if ((!targetProjectId || targetProjectId.startsWith('$')) && resolvedParams.projectName) {
            const queryName = String(resolvedParams.projectName).trim();
            const projectRecord = await prisma.project.findFirst({
              where: {
                name: { contains: queryName, mode: 'insensitive' },
                ...(orgId ? { organizationId: orgId } : {}),
              },
              select: { id: true },
            });
            if (projectRecord) {
              targetProjectId = projectRecord.id;
            }
          }

          if (!targetProjectId || targetProjectId.startsWith('$')) {
            const userProject = await prisma.projectMember.findFirst({
              where: { userId },
              select: { projectId: true },
            });
            targetProjectId = userProject?.projectId;
          }

          if (!targetProjectId) {
            throw new ApiError(404, `Project '${resolvedParams.projectName || 'specified'}' not found`);
          }

          let memberEmail = resolvedParams.email ? String(resolvedParams.email).trim().toLowerCase() : undefined;
          if (!memberEmail && resolvedParams.memberName) {
            const queryName = String(resolvedParams.memberName).trim();
            const matchedUser = await prisma.user.findFirst({
              where: {
                name: { contains: queryName, mode: 'insensitive' },
              },
              select: { email: true },
            });
            if (matchedUser) {
              memberEmail = matchedUser.email.toLowerCase();
            }
          }

          if (!memberEmail) {
            throw new ApiError(400, 'Member email or member name is required to invite to project');
          }

          let projectRole: ProjectRole = ProjectRole.INTERNAL_MEMBER;
          if (resolvedParams.role) {
            const requestedRole = String(resolvedParams.role).toUpperCase().trim();
            if (requestedRole === 'PROJECT_MANAGER' || requestedRole === 'MANAGER') {
              projectRole = ProjectRole.PROJECT_MANAGER;
            } else if (requestedRole === 'FREELANCER') {
              projectRole = ProjectRole.FREELANCER;
            } else if (requestedRole === 'CLIENT') {
              projectRole = ProjectRole.CLIENT;
            }
          }

          if (projectRole === ProjectRole.PROJECT_MANAGER) {
            const project = await prisma.project.findUnique({
              where: { id: targetProjectId },
              select: { organizationId: true },
            });
            let isAuthorizedForPm = false;
            if (project?.organizationId) {
              const callerOrg = await getUserOrganizationContext(userId, project.organizationId);
              if (callerOrg?.isOwner || callerOrg?.userRole === OrgRole.ORG_ADMIN) {
                isAuthorizedForPm = true;
              }
            }
            const existingPm = await prisma.projectMember.findFirst({
              where: {
                projectId: targetProjectId,
                userId,
                role: ProjectRole.PROJECT_MANAGER,
              },
            });
            if (existingPm) {
              isAuthorizedForPm = true;
            }
            if (!isAuthorizedForPm) {
              throw new ApiError(403, 'Only project managers or organization admins can assign the project manager role');
            }
          }

          const inviteResult = await inviteProjectMember(userId, targetProjectId, {
            email: memberEmail,
            role: projectRole,
            hourlyRate: resolvedParams.hourlyRate !== undefined ? Number(resolvedParams.hourlyRate) : undefined,
            companyId: resolvedParams.companyId ? String(resolvedParams.companyId).trim() : undefined,
            companyName: resolvedParams.companyName ? String(resolvedParams.companyName).trim() : undefined,
          });

          const inviteId = (inviteResult as any)?.id || (inviteResult as any)?.invite?.id || '';
          if (inviteId) {
            variables.set(`$step${step.step}.inviteId`, inviteId);
            variables.set(`$step${step.step}.id`, inviteId);
          }
          variables.set(`$step${step.step}.projectId`, targetProjectId);
          variables.set(`$step${step.step}.email`, memberEmail);

          results.push({
            step: step.step,
            action: 'ADD_PROJECT_MEMBER',
            description: step.description,
            success: true,
            resource: {
              projectId: targetProjectId,
              email: memberEmail,
              role: projectRole,
              invite: inviteResult,
            },
          });
        } else if (step.action === 'ARCHIVE_DOCUMENT') {
          let targetDocId = resolvedParams.documentId ? String(resolvedParams.documentId).trim() : undefined;
          if ((!targetDocId || targetDocId.startsWith('$')) && (resolvedParams.documentTitle || resolvedParams.title)) {
            const queryTitle = String(resolvedParams.documentTitle || resolvedParams.title).trim();
            const matchedDoc = await prisma.document.findFirst({
              where: {
                title: { contains: queryTitle, mode: 'insensitive' },
                isArchived: false,
                OR: [
                  { createdById: userId },
                  { collaborators: { some: { userId } } },
                ],
              },
              select: { id: true },
            });
            if (matchedDoc) {
              targetDocId = matchedDoc.id;
            }
          }

          if (!targetDocId || targetDocId.startsWith('$')) {
            const recentDoc = await prisma.document.findFirst({
              where: {
                createdById: userId,
                isArchived: false,
              },
              orderBy: { updatedAt: 'desc' },
              select: { id: true },
            });
            targetDocId = recentDoc?.id;
          }

          if (!targetDocId) {
            throw new ApiError(404, `Document '${resolvedParams.documentTitle || resolvedParams.title || 'specified'}' not found to archive`);
          }

          const updatedDoc = await updateDocument(userId, targetDocId, { isArchived: true });

          variables.set(`$step${step.step}.documentId`, updatedDoc.id);
          variables.set(`$step${step.step}.id`, updatedDoc.id);

          results.push({
            step: step.step,
            action: 'ARCHIVE_DOCUMENT',
            description: step.description,
            success: true,
            resource: {
              documentId: updatedDoc.id,
              title: updatedDoc.title,
              isArchived: true,
            },
          });
        } else if (step.action === 'SET_USER_STATUS' || step.action === 'UPDATE_USER_STATUS') {
          const rawStatus = String(resolvedParams.status || 'AVAILABLE').toUpperCase().trim();
          let presenceStatus: PresenceStatus = 'AVAILABLE';

          if (rawStatus === 'DO_NOT_DISTURB' || rawStatus === 'DND') {
            presenceStatus = 'DO_NOT_DISTURB';
          } else if (rawStatus === 'BUSY') {
            presenceStatus = 'BUSY';
          } else if (rawStatus === 'BE_RIGHT_BACK' || rawStatus === 'BRB') {
            presenceStatus = 'BE_RIGHT_BACK';
          } else if (rawStatus === 'AWAY') {
            presenceStatus = 'AWAY';
          } else if (rawStatus === 'OFFLINE') {
            presenceStatus = 'OFFLINE';
          } else if (rawStatus === 'AVAILABLE' || rawStatus === 'ONLINE') {
            presenceStatus = 'AVAILABLE';
          }

          const statusMessage = resolvedParams.statusMessage ? String(resolvedParams.statusMessage).trim().slice(0, 100) : null;
          const clearAfterMinutes = resolvedParams.clearAfterMinutes !== undefined && resolvedParams.clearAfterMinutes !== null && !isNaN(Number(resolvedParams.clearAfterMinutes))
            ? Number(resolvedParams.clearAfterMinutes)
            : null;

          const updatedPresence = await setUserCustomStatus(userId, {
            status: presenceStatus,
            statusMessage,
            clearAfterMinutes,
          });

          try {
            await broadcastUserPresenceUpdate(getIO(), userId, updatedPresence);
          } catch (broadcastErr) {
            logger.warn('Failed to broadcast user presence update', broadcastErr);
          }

          variables.set(`$step${step.step}.status`, presenceStatus);
          if (statusMessage) {
            variables.set(`$step${step.step}.statusMessage`, statusMessage);
          }

          results.push({
            step: step.step,
            action: 'SET_USER_STATUS',
            description: step.description,
            success: true,
            resource: {
              userId,
              status: presenceStatus,
              statusMessage,
              clearAfterMinutes,
              isOnline: updatedPresence.isOnline,
            },
          });
        } else if (step.action === 'RESCHEDULE_MEETING' || step.action === 'MOVE_MEETING' || step.action === 'CHANGE_MEETING_TIME') {
          let meeting: any = null;
          if (resolvedParams.meetingCode || resolvedParams.code) {
            const codeQuery = String(resolvedParams.meetingCode || resolvedParams.code).trim();
            meeting = await prisma.meeting.findUnique({
              where: { code: codeQuery },
            });
          }
          if (!meeting && resolvedParams.meetingId) {
            const idQuery = String(resolvedParams.meetingId).trim();
            meeting = await prisma.meeting.findUnique({
              where: { id: idQuery },
            });
          }
          if (!meeting && resolvedParams.title) {
            const titleQuery = String(resolvedParams.title).trim();
            meeting = await prisma.meeting.findFirst({
              where: {
                hostId: userId,
                title: { contains: titleQuery, mode: 'insensitive' },
                status: { in: [MeetingStatus.SCHEDULED, MeetingStatus.ACTIVE] },
              },
              orderBy: { scheduledStartTime: 'asc' },
            });
          }
          if (!meeting) {
            meeting = await prisma.meeting.findFirst({
              where: {
                hostId: userId,
                status: MeetingStatus.SCHEDULED,
              },
              orderBy: { scheduledStartTime: 'asc' },
            });
          }

          if (!meeting) {
            throw new ApiError(404, 'Meeting to reschedule not found');
          }

          if (meeting.hostId !== userId) {
            throw new ApiError(403, 'Only the meeting host can reschedule the meeting');
          }

          const rawStart = resolvedParams.startTime || resolvedParams.newStartTime;
          if (!rawStart) {
            throw new ApiError(400, 'New meeting startTime is required');
          }

          let newStart = new Date(rawStart);
          if (isNaN(newStart.getTime())) {
            throw new ApiError(400, 'Invalid meeting startTime format');
          }

          if (newStart.getTime() < Date.now() - 60000) {
            const adjusted = new Date();
            adjusted.setHours(newStart.getHours(), newStart.getMinutes(), 0, 0);
            if (adjusted.getTime() < Date.now()) {
              adjusted.setDate(adjusted.getDate() + 1);
            }
            if (adjusted.getTime() >= Date.now()) {
              newStart = adjusted;
            } else {
              throw new ApiError(400, 'Meeting startTime cannot be in the past');
            }
          }

          const duration = resolvedParams.durationMinutes !== undefined && resolvedParams.durationMinutes !== null
            ? Number(resolvedParams.durationMinutes)
            : 60;

          if (isNaN(duration) || duration <= 0 || duration > 1440) {
            throw new ApiError(400, 'durationMinutes must be a positive number between 1 and 1440');
          }

          newStart = await checkAndAdjustMeetingConflict(userId, newStart, duration, meeting.code);

          const updatedMeeting = await prisma.meeting.update({
            where: { id: meeting.id },
            data: {
              scheduledStartTime: newStart,
            },
          });

          await prisma.calendarEvent.updateMany({
            where: {
              userId,
              meetingLink: { contains: meeting.code },
            },
            data: {
              startDate: newStart,
              endDate: new Date(newStart.getTime() + duration * 60 * 1000),
            },
          });

          try {
            getIO().to(`meeting:${meeting.code}`).emit('meeting:rescheduled', {
              meetingCode: meeting.code,
              scheduledStartTime: newStart,
              durationMinutes: duration,
            });
          } catch {}

          variables.set(`$step${step.step}.meetingId`, updatedMeeting.id);
          variables.set(`$step${step.step}.meetingCode`, updatedMeeting.code);
          variables.set(`$step${step.step}.scheduledStartTime`, newStart.toISOString());

          results.push({
            step: step.step,
            action: 'RESCHEDULE_MEETING',
            description: step.description,
            success: true,
            resource: {
              meetingId: updatedMeeting.id,
              meetingCode: updatedMeeting.code,
              title: updatedMeeting.title,
              scheduledStartTime: updatedMeeting.scheduledStartTime,
              durationMinutes: duration,
            },
          });
        } else if (step.action === 'CREATE_PROJECT_TASK' || step.action === 'ADD_PROJECT_TASK') {
          const taskTitle = sanitizeWorkflowText(String(resolvedParams.title || resolvedParams.name || '')).trim();
          if (!taskTitle) {
            throw new ApiError(400, 'Project task title is required');
          }

          const taskDescription = resolvedParams.description
            ? sanitizeWorkflowText(String(resolvedParams.description)).trim()
            : undefined;

          let targetProjectId = resolvedParams.projectId ? String(resolvedParams.projectId).trim() : undefined;
          if (!targetProjectId && resolvedParams.projectName) {
            const queryName = String(resolvedParams.projectName).trim();
            const project = await prisma.project.findFirst({
              where: {
                name: { contains: queryName, mode: 'insensitive' },
                members: { some: { userId } },
              },
              select: { id: true },
            });
            if (project) {
              targetProjectId = project.id;
            }
          }

          if (!targetProjectId) {
            const recentProjectMember = await prisma.projectMember.findFirst({
              where: { userId },
              select: { projectId: true },
              orderBy: { joinedAt: 'desc' },
            });
            targetProjectId = recentProjectMember?.projectId;
          }

          if (!targetProjectId) {
            throw new ApiError(404, `Project '${resolvedParams.projectName || 'specified'}' not found`);
          }

          if (plan.organizationId) {
            const projCheck = await prisma.project.findUnique({
              where: { id: targetProjectId },
              select: { organizationId: true },
            });
            if (projCheck?.organizationId && projCheck.organizationId !== plan.organizationId) {
              throw new ApiError(403, 'Cross-organization operation blocked: Target project belongs to another organization');
            }
          }

          let assigneeId = resolvedParams.assigneeId ? String(resolvedParams.assigneeId).trim() : undefined;
          if (!assigneeId && resolvedParams.assigneeName) {
            const assigneeQuery = String(resolvedParams.assigneeName).trim();
            const matchedMember = await prisma.projectMember.findFirst({
              where: {
                projectId: targetProjectId,
                user: { name: { contains: assigneeQuery, mode: 'insensitive' } },
              },
              select: { userId: true },
            });
            if (matchedMember) {
              assigneeId = matchedMember.userId;
            }
          }

          if (!assigneeId) {
            assigneeId = userId;
          }

          let priority: TaskPriority = TaskPriority.MEDIUM;
          if (resolvedParams.priority) {
            const p = String(resolvedParams.priority).toUpperCase();
            if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(p)) {
              priority = p as TaskPriority;
            }
          }

          let dueDate: Date | undefined;
          if (resolvedParams.dueDate) {
            const parsedDue = new Date(resolvedParams.dueDate);
            if (!isNaN(parsedDue.getTime())) {
              dueDate = parsedDue;
            }
          }

          const projectTask = await createProjectTask(userId, targetProjectId, {
            title: taskTitle,
            description: taskDescription,
            dueDate: dueDate ? dueDate.toISOString() : undefined,
            priority,
            assigneeId,
          });

          variables.set(`$step${step.step}.taskId`, projectTask.id);
          variables.set(`$step${step.step}.id`, projectTask.id);
          variables.set(`$step${step.step}.title`, projectTask.title);
          variables.set(`$step${step.step}.projectId`, targetProjectId);

          results.push({
            step: step.step,
            action: 'CREATE_PROJECT_TASK',
            description: step.description,
            success: true,
            resource: {
              taskId: projectTask.id,
              title: projectTask.title,
              projectId: targetProjectId,
              priority: projectTask.priority,
              status: projectTask.status,
              assigneeId: projectTask.assigneeId,
              dueDate: projectTask.dueDate,
            },
          });
        } else if (step.action === 'UNPIN_CHAT_MESSAGE' || step.action === 'UNPIN_MESSAGE') {
          let targetConvId = resolvedParams.conversationId ? String(resolvedParams.conversationId).trim() : undefined;
          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.teamId) {
            const teamConv = await prisma.conversation.findFirst({
              where: { teamId: String(resolvedParams.teamId).trim() },
              select: { id: true },
            });
            if (teamConv) {
              targetConvId = teamConv.id;
            }
          }

          if ((!targetConvId || targetConvId.startsWith('$')) && resolvedParams.teamName) {
            const teamQuery = String(resolvedParams.teamName).trim();
            const team = await prisma.team.findFirst({
              where: { name: { contains: teamQuery, mode: 'insensitive' } },
              select: { id: true },
            });
            if (team) {
              const teamConv = await prisma.conversation.findFirst({
                where: { teamId: team.id },
                select: { id: true },
              });
              if (teamConv) {
                targetConvId = teamConv.id;
              }
            }
          }

          let messageId = resolvedParams.messageId ? String(resolvedParams.messageId).trim() : undefined;
          if (!messageId && targetConvId) {
            const pinnedMsg = await prisma.message.findFirst({
              where: {
                conversationId: targetConvId,
                isPinned: true,
              },
              orderBy: { updatedAt: 'desc' },
              select: { id: true },
            });
            if (pinnedMsg) {
              messageId = pinnedMsg.id;
            }
          }

          if (!messageId) {
            const userPinned = await prisma.message.findFirst({
              where: {
                isPinned: true,
                conversation: {
                  participants: { some: { userId } },
                },
              },
              orderBy: { updatedAt: 'desc' },
              select: { id: true, conversationId: true },
            });
            if (userPinned) {
              messageId = userPinned.id;
              if (!targetConvId) {
                targetConvId = userPinned.conversationId;
              }
            }
          }

          if (!messageId || !targetConvId) {
            throw new ApiError(404, 'No pinned message found to unpin');
          }

          await unpinMessage(userId, targetConvId, messageId);

          variables.set(`$step${step.step}.messageId`, messageId);
          variables.set(`$step${step.step}.conversationId`, targetConvId);

          results.push({
            step: step.step,
            action: 'UNPIN_CHAT_MESSAGE',
            description: step.description,
            success: true,
            resource: {
              messageId,
              conversationId: targetConvId,
              unpinned: true,
            },
          });
        } else if (step.action === 'CREATE_CALENDAR_EVENT' || step.action === 'SCHEDULE_EVENT' || step.action === 'CREATE_EVENT' || step.action === 'ADD_REMINDER') {
          const eventTitle = sanitizeWorkflowText(String(resolvedParams.title || resolvedParams.name || 'Calendar Event')).trim();
          if (!eventTitle) {
            throw new ApiError(400, 'Calendar event title is required');
          }

          const eventDescription = resolvedParams.description
            ? sanitizeWorkflowText(String(resolvedParams.description)).trim()
            : undefined;

          const rawStart = resolvedParams.startDate || resolvedParams.startTime || resolvedParams.date;
          if (!rawStart) {
            throw new ApiError(400, 'Calendar event startDate is required');
          }

          let startDate = new Date(rawStart);
          if (isNaN(startDate.getTime())) {
            throw new ApiError(400, 'Invalid startDate format for calendar event');
          }

          if (startDate.getTime() < Date.now() - 60000) {
            const adjusted = new Date();
            adjusted.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
            if (adjusted.getTime() < Date.now()) {
              adjusted.setDate(adjusted.getDate() + 1);
            }
            if (adjusted.getTime() >= Date.now()) {
              startDate = adjusted;
            } else {
              throw new ApiError(400, 'Calendar event date cannot be in the past');
            }
          }

          let endDate = resolvedParams.endDate || resolvedParams.endTime
            ? new Date(resolvedParams.endDate || resolvedParams.endTime)
            : new Date(startDate.getTime() + 60 * 60 * 1000);

          if (isNaN(endDate.getTime()) || endDate.getTime() < startDate.getTime()) {
            endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
          }

          const isAllDay = Boolean(resolvedParams.isAllDay);
          const hasReminder = resolvedParams.hasReminder !== undefined ? Boolean(resolvedParams.hasReminder) : true;
          const reminderMinutes = resolvedParams.reminderMinutes !== undefined && resolvedParams.reminderMinutes !== null
            ? Number(resolvedParams.reminderMinutes)
            : 15;

          const attendeeEmails = Array.isArray(resolvedParams.attendeeEmails)
            ? resolvedParams.attendeeEmails.map((e: any) => String(e).trim().toLowerCase()).filter(Boolean)
            : undefined;

          if (attendeeEmails) {
            attendeeEmails.forEach(validateSafeUrlAndDomain);
          }

          const eventType = resolvedParams.eventType ? String(resolvedParams.eventType).trim() : 'EVENT';

          const calendarEvent = await createCalendarEvent(userId, {
            title: eventTitle,
            description: eventDescription,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            eventType: eventType as any,
            isAllDay,
            hasReminder,
            reminderMinutes,
            attendeeEmails,
          });

          compensationStack.push({ type: 'CALENDAR_EVENT', id: calendarEvent.id });

          variables.set(`$step${step.step}.eventId`, calendarEvent.id);
          variables.set(`$step${step.step}.id`, calendarEvent.id);
          variables.set(`$step${step.step}.title`, calendarEvent.title);

          results.push({
            step: step.step,
            action: 'CREATE_CALENDAR_EVENT',
            description: step.description,
            success: true,
            resource: {
              eventId: calendarEvent.id,
              title: calendarEvent.title,
              startDate: calendarEvent.startDate,
              endDate: calendarEvent.endDate,
              isAllDay: calendarEvent.isAllDay,
              hasReminder: calendarEvent.hasReminder,
            },
          });
        } else if (step.action === 'UPDATE_MEMBER_ROLE' || step.action === 'CHANGE_MEMBER_ROLE' || step.action === 'SET_MEMBER_ROLE') {
          const isProjectRole = Boolean(
            resolvedParams.projectId ||
            resolvedParams.projectName ||
            resolvedParams.projectRole ||
            (resolvedParams.role && ['PROJECT_MANAGER', 'INTERNAL_MEMBER', 'FREELANCER', 'CLIENT'].includes(String(resolvedParams.role).toUpperCase()))
          );

          if (isProjectRole) {
            let targetProjectId = resolvedParams.projectId ? String(resolvedParams.projectId).trim() : undefined;
            if (!targetProjectId && resolvedParams.projectName) {
              const queryName = String(resolvedParams.projectName).trim();
              const proj = await prisma.project.findFirst({
                where: {
                  name: { contains: queryName, mode: 'insensitive' },
                  members: { some: { userId } },
                },
                select: { id: true },
              });
              if (proj) {
                targetProjectId = proj.id;
              }
            }

            if (!targetProjectId) {
              const recentProj = await prisma.projectMember.findFirst({
                where: { userId },
                select: { projectId: true },
                orderBy: { joinedAt: 'desc' },
              });
              targetProjectId = recentProj?.projectId;
            }

            if (!targetProjectId) {
              throw new ApiError(404, `Project '${resolvedParams.projectName || 'specified'}' not found`);
            }

            const project = await prisma.project.findUnique({
              where: { id: targetProjectId },
              select: { id: true, createdById: true, organizationId: true },
            });

            if (!project) {
              throw new ApiError(404, 'Project not found');
            }

            let targetUserId = resolvedParams.targetUserId || resolvedParams.memberId || resolvedParams.userId
              ? String(resolvedParams.targetUserId || resolvedParams.memberId || resolvedParams.userId).trim()
              : undefined;

            if (!targetUserId && resolvedParams.memberName) {
              const mQuery = String(resolvedParams.memberName).trim();
              const matchedProjUser = await prisma.projectMember.findFirst({
                where: {
                  projectId: targetProjectId,
                  user: { name: { contains: mQuery, mode: 'insensitive' } },
                },
                select: { userId: true },
              });
              if (matchedProjUser) {
                targetUserId = matchedProjUser.userId;
              }
            }

            if (!targetUserId && resolvedParams.memberEmail) {
              const eQuery = String(resolvedParams.memberEmail).trim().toLowerCase();
              const matchedProjUser = await prisma.projectMember.findFirst({
                where: {
                  projectId: targetProjectId,
                  user: { email: { equals: eQuery, mode: 'insensitive' } },
                },
                select: { userId: true },
              });
              if (matchedProjUser) {
                targetUserId = matchedProjUser.userId;
              }
            }

            if (!targetUserId) {
              throw new ApiError(404, `Project member '${resolvedParams.memberName || resolvedParams.memberEmail || 'specified'}' not found`);
            }

            if (project.createdById === targetUserId && targetUserId !== userId) {
              throw new ApiError(403, 'Cannot change the role of the project creator');
            }

            const rawRole = String(resolvedParams.projectRole || resolvedParams.role || 'INTERNAL_MEMBER').toUpperCase();
            const validRoles: ProjectRole[] = [ProjectRole.PROJECT_MANAGER, ProjectRole.INTERNAL_MEMBER, ProjectRole.FREELANCER, ProjectRole.CLIENT];
            const targetRole = validRoles.includes(rawRole as ProjectRole) ? (rawRole as ProjectRole) : ProjectRole.INTERNAL_MEMBER;

            const callerMembership = await prisma.projectMember.findFirst({
              where: { projectId: targetProjectId, userId },
              select: { role: true },
            });
            if (targetUserId === userId && targetRole === ProjectRole.PROJECT_MANAGER && callerMembership?.role !== ProjectRole.PROJECT_MANAGER && project.createdById !== userId) {
              throw new ApiError(403, 'Privilege escalation blocked: You cannot self-promote to PROJECT_MANAGER');
            }

            const updatedMember = await updateProjectMember(userId, targetProjectId, targetUserId, {
              role: targetRole,
            });

            variables.set(`$step${step.step}.projectId`, targetProjectId);
            variables.set(`$step${step.step}.targetUserId`, targetUserId);
            variables.set(`$step${step.step}.role`, targetRole);

            results.push({
              step: step.step,
              action: 'UPDATE_MEMBER_ROLE',
              description: step.description,
              success: true,
              resource: {
                projectId: targetProjectId,
                targetUserId,
                role: targetRole,
                member: updatedMember,
              },
            });
          } else {
            let targetOrgId = resolvedParams.organizationId ? String(resolvedParams.organizationId).trim() : orgId;
            let team: any = null;
            if (resolvedParams.teamId) {
              team = await prisma.team.findUnique({
                where: { id: String(resolvedParams.teamId).trim() },
                select: { id: true, name: true, organizationId: true },
              });
            }
            if (!team && resolvedParams.teamName) {
              const teamQuery = String(resolvedParams.teamName).trim();
              team = await prisma.team.findFirst({
                where: {
                  ...(targetOrgId ? { organizationId: targetOrgId } : {}),
                  name: { contains: teamQuery, mode: 'insensitive' },
                },
                select: { id: true, name: true, organizationId: true },
              });
            }

            if (!team) {
              const userTeam = await prisma.teamMember.findFirst({
                where: { userId },
                select: {
                  team: { select: { id: true, name: true, organizationId: true } },
                },
              });
              team = userTeam?.team;
            }

            if (!team) {
              throw new ApiError(404, `Team '${resolvedParams.teamName || 'specified'}' not found`);
            }

            const finalOrgId = String(team.organizationId || targetOrgId || '').trim();
            const callerOrg = await getUserOrganizationContext(userId, finalOrgId);
            const callerTeamMember = await prisma.teamMember.findUnique({
              where: {
                teamId_userId: {
                  teamId: team.id,
                  userId,
                },
              },
            });

            const isOrgAdminOrOwner = callerOrg?.isOwner || callerOrg?.userRole === OrgRole.ORG_ADMIN;
            const isTeamLead = callerTeamMember?.role === 'LEAD';

            if (!isOrgAdminOrOwner && !isTeamLead) {
              throw new ApiError(403, 'Only team leads or organization admins can update team member roles');
            }

            let targetUserId = resolvedParams.targetUserId || resolvedParams.memberId || resolvedParams.userId
              ? String(resolvedParams.targetUserId || resolvedParams.memberId || resolvedParams.userId).trim()
              : undefined;

            if (!targetUserId && resolvedParams.memberName) {
              const mQuery = String(resolvedParams.memberName).trim();
              const matchedMember = await prisma.teamMember.findFirst({
                where: {
                  teamId: team.id,
                  user: { name: { contains: mQuery, mode: 'insensitive' } },
                },
                select: { userId: true },
              });
              if (matchedMember) {
                targetUserId = matchedMember.userId;
              }
            }

            if (!targetUserId && resolvedParams.memberEmail) {
              const eQuery = String(resolvedParams.memberEmail).trim().toLowerCase();
              const matchedMember = await prisma.teamMember.findFirst({
                where: {
                  teamId: team.id,
                  user: { email: { equals: eQuery, mode: 'insensitive' } },
                },
                select: { userId: true },
              });
              if (matchedMember) {
                targetUserId = matchedMember.userId;
              }
            }

            if (!targetUserId) {
              throw new ApiError(404, `Team member '${resolvedParams.memberName || resolvedParams.memberEmail || 'specified'}' not found in team '${team.name}'`);
            }

            const org = await prisma.organization.findUnique({
              where: { id: finalOrgId },
              select: { ownerId: true },
            });

            if (org?.ownerId === targetUserId && targetUserId !== userId) {
              throw new ApiError(403, 'Cannot change the role of the organization owner');
            }

            const rawRoleStr = String(resolvedParams.teamRole || resolvedParams.role || 'member').toLowerCase();
            const assignedRole = rawRoleStr.includes('lead') || rawRoleStr.includes('admin') || rawRoleStr.includes('leader') ? 'LEAD' : 'member';

            if (targetUserId === userId && assignedRole === 'LEAD' && !isTeamLead && !isOrgAdminOrOwner) {
              throw new ApiError(403, 'Privilege escalation blocked: You cannot self-promote to team LEAD');
            }

            await prisma.$transaction(async (tx) => {
              await tx.teamMember.update({
                where: {
                  teamId_userId: {
                    teamId: team.id,
                    userId: targetUserId,
                  },
                },
                data: { role: assignedRole },
              });

              const teamConv = await tx.conversation.findFirst({
                where: { teamId: team.id },
                select: { id: true },
              });

              if (teamConv) {
                await tx.conversationParticipant.upsert({
                  where: {
                    conversationId_userId: {
                      conversationId: teamConv.id,
                      userId: targetUserId,
                    },
                  },
                  create: {
                    conversationId: teamConv.id,
                    userId: targetUserId,
                    role: assignedRole === 'LEAD' ? 'admin' : 'member',
                  },
                  update: {
                    role: assignedRole === 'LEAD' ? 'admin' : 'member',
                  },
                });
              }
            });

            variables.set(`$step${step.step}.teamId`, team.id);
            variables.set(`$step${step.step}.targetUserId`, targetUserId);
            variables.set(`$step${step.step}.role`, assignedRole);

            results.push({
              step: step.step,
              action: 'UPDATE_MEMBER_ROLE',
              description: step.description,
              success: true,
              resource: {
                teamId: team.id,
                teamName: team.name,
                targetUserId,
                role: assignedRole,
              },
            });
          }
        } else if (step.action === 'DELETE_CALENDAR_EVENT' || step.action === 'CANCEL_EVENT' || step.action === 'REMOVE_EVENT' || step.action === 'DELETE_EVENT') {
          let eventId = resolvedParams.eventId || resolvedParams.id ? String(resolvedParams.eventId || resolvedParams.id).trim() : undefined;
          if (!eventId && resolvedParams.title) {
            const titleQuery = String(resolvedParams.title).trim();
            const matchedEvent = await prisma.calendarEvent.findFirst({
              where: {
                userId,
                title: { contains: titleQuery, mode: 'insensitive' },
              },
              orderBy: { startDate: 'desc' },
            });
            if (matchedEvent) {
              eventId = matchedEvent.id;
            }
          }

          if (!eventId) {
            const nearestEvent = await prisma.calendarEvent.findFirst({
              where: {
                userId,
                startDate: { gte: new Date() },
              },
              orderBy: { startDate: 'asc' },
            });
            if (nearestEvent) {
              eventId = nearestEvent.id;
            }
          }

          if (!eventId) {
            throw new ApiError(404, 'Calendar event to delete not found');
          }

          await deleteCalendarEvent(userId, eventId);

          variables.set(`$step${step.step}.eventId`, eventId);
          variables.set(`$step${step.step}.deletedEventId`, eventId);

          results.push({
            step: step.step,
            action: 'DELETE_CALENDAR_EVENT',
            description: step.description,
            success: true,
            resource: {
              eventId,
              deleted: true,
            },
          });
        }
      })(), 15000, step.step);
    } catch (err: any) {
        logger.error(`Error executing workflow step ${step.step} (${step.action})`, err);
        while (compensationStack.length > 0) {
          const comp = compensationStack.pop();
          if (!comp) continue;
          try {
            if (comp.type === 'TEAM') await prisma.team.delete({ where: { id: comp.id } });
            else if (comp.type === 'PROJECT') await prisma.project.delete({ where: { id: comp.id } });
            else if (comp.type === 'DOCUMENT') await prisma.document.delete({ where: { id: comp.id } });
            else if (comp.type === 'CALENDAR_EVENT') await prisma.calendarEvent.delete({ where: { id: comp.id } });
            else if (comp.type === 'TASK') await prisma.teamTask.delete({ where: { id: comp.id } });
            else if (comp.type === 'WHITEBOARD') await prisma.whiteboard.delete({ where: { id: comp.id } });
          } catch {}
        }
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

    await recordWorkflowAuditEvent({
      planId,
      userId,
      organizationId: plan.organizationId,
      summary: plan.summary,
      status: finalStatus,
      results,
      timestamp: new Date().toISOString(),
    });

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
    if (userSemaphoreAcquired) {
      try {
        await redis.del(userExecLockKey);
      } catch {}
    }
  }
};
