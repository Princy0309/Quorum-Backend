import prisma from '../config/prisma.js';
import { MeetingScopeType, MeetingStatus, OrgRole } from '@prisma/client';
import logger from '../utils/logger.js';

export interface CanCreateMeetingInput {
  scopeType: MeetingScopeType;
  organizationId?: string | null;
  teamId?: string | null;
  scheduledStartTime?: Date | string | null;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  statusCode?: number;
}

export const canUserCreateMeeting = async (
  userId: string,
  input: CanCreateMeetingInput
): Promise<PermissionCheckResult> => {
  try {
    const { scopeType, organizationId, teamId, scheduledStartTime } = input;

    if (scheduledStartTime) {
      const parsedTime = new Date(scheduledStartTime).getTime();
      if (isNaN(parsedTime)) {
        return { allowed: false, reason: 'Invalid scheduledStartTime format', statusCode: 400 };
      }
      if (parsedTime < Date.now() - 60000) {
        return { allowed: false, reason: 'scheduledStartTime cannot be in the past', statusCode: 400 };
      }
    }

    if (scopeType === MeetingScopeType.PERSONAL) {
      return { allowed: true };
    }

    if (scopeType === MeetingScopeType.ORGANIZATION) {
      if (!organizationId) {
        return { allowed: false, reason: 'organizationId is required for ORGANIZATION scope', statusCode: 400 };
      }

      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { ownerId: true },
      });

      if (!org) {
        return { allowed: false, reason: 'Organization not found', statusCode: 404 };
      }

      if (org.ownerId === userId) {
        return { allowed: true };
      }

      const orgMember = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
      });

      if (!orgMember || orgMember.role !== OrgRole.ORG_ADMIN) {
        return {
          allowed: false,
          reason: 'Only organization admins can create organization-scoped meetings',
          statusCode: 403,
        };
      }

      return { allowed: true };
    }

    if (scopeType === MeetingScopeType.TEAM) {
      if (!organizationId || !teamId) {
        return {
          allowed: false,
          reason: 'Both organizationId and teamId are required for TEAM scope',
          statusCode: 400,
        };
      }

      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          organizationId: true,
          organization: { select: { ownerId: true } },
        },
      });

      if (!team || team.organizationId !== organizationId) {
        return {
          allowed: false,
          reason: 'Team not found within the specified organization',
          statusCode: 404,
        };
      }

      if (team.organization?.ownerId === userId) {
        return { allowed: true };
      }

      const orgMember = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
      });

      if (orgMember && orgMember.role === OrgRole.ORG_ADMIN) {
        return { allowed: true };
      }

      const teamMember = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      });

      const isLead =
        teamMember &&
        ['LEAD', 'lead', 'ADMIN', 'admin'].includes(teamMember.role);

      if (!isLead) {
        return {
          allowed: false,
          reason: 'Only team leads or organization admins can create team-scoped meetings',
          statusCode: 403,
        };
      }

      return { allowed: true };
    }

    return { allowed: false, reason: 'Invalid meeting scopeType', statusCode: 400 };
  } catch (error) {
    logger.error('[PermissionService] canUserCreateMeeting failed unexpectedly', {
      userId,
      input,
      error: error instanceof Error ? error.message : error,
    });
    return { allowed: false, reason: 'Permission verification failed', statusCode: 500 };
  }
};

export const canUserJoinMeeting = async (
  userId: string,
  meetingCode: string
): Promise<PermissionCheckResult> => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { code: meetingCode },
      select: {
        id: true,
        code: true,
        hostId: true,
        scopeType: true,
        status: true,
        organizationId: true,
        teamId: true,
        scheduledStartTime: true,
      },
    });

    if (!meeting) {
      return { allowed: false, reason: 'Meeting not found', statusCode: 404 };
    }

    if (meeting.status === MeetingStatus.CANCELLED) {
      return { allowed: false, reason: 'This meeting has been cancelled', statusCode: 410 };
    }

    if (meeting.status === MeetingStatus.ENDED) {
      return { allowed: false, reason: 'This meeting has ended', statusCode: 410 };
    }

    if (meeting.hostId === userId) {
      return { allowed: true };
    }

    if (meeting.status === MeetingStatus.SCHEDULED && meeting.scheduledStartTime) {
      const now = Date.now();
      const startTime = new Date(meeting.scheduledStartTime).getTime();
      const earlyJoinWindow = 15 * 60 * 1000; // 15 minutes

      if (now < startTime - earlyJoinWindow) {
        return {
          allowed: false,
          reason: 'This meeting has not started yet. You can join 15 minutes before the scheduled start time.',
          statusCode: 403,
        };
      }
    }

    if (meeting.scopeType === MeetingScopeType.PERSONAL) {
      return { allowed: true };
    }

    if (meeting.scopeType === MeetingScopeType.ORGANIZATION) {
      if (!meeting.organizationId) {
        return { allowed: false, reason: 'Meeting organization configuration is invalid', statusCode: 500 };
      }

      const orgMember = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: meeting.organizationId,
            userId,
          },
        },
      });

      if (!orgMember) {
        return {
          allowed: false,
          reason: 'You must be a member of this organization to join this meeting',
          statusCode: 403,
        };
      }

      return { allowed: true };
    }

    if (meeting.scopeType === MeetingScopeType.TEAM) {
      if (!meeting.teamId) {
        return { allowed: false, reason: 'Meeting team configuration is invalid', statusCode: 500 };
      }

      if (meeting.organizationId) {
        const orgMember = await prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId: meeting.organizationId,
              userId,
            },
          },
        });

        if (orgMember && orgMember.role === OrgRole.ORG_ADMIN) {
          return { allowed: true };
        }
      }

      const teamMember = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: meeting.teamId,
            userId,
          },
        },
      });

      if (!teamMember) {
        return {
          allowed: false,
          reason: 'You must be a member of this team to join this meeting',
          statusCode: 403,
        };
      }

      return { allowed: true };
    }

    return { allowed: false, reason: 'Unknown meeting scope', statusCode: 400 };
  } catch (error) {
    logger.error('[PermissionService] canUserJoinMeeting failed unexpectedly', {
      userId,
      meetingCode,
      error: error instanceof Error ? error.message : error,
    });
    return { allowed: false, reason: 'Authorization check failed', statusCode: 500 };
  }
};
