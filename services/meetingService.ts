import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { MeetingScopeType, MeetingStatus, OrgRole } from '@prisma/client';
import { closeMeetingRoom } from '../sockets/meetingPresence.js';
import { canUserCreateMeeting, canUserJoinMeeting } from './meetingPermissionService.js';

const generateCode = (): string => {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const part = () =>
    Array.from(crypto.randomBytes(3))
      .map((b) => letters[b % 26])
      .join('');
  return `${part()}-${part()}-${part()}`;
};

export const createMeeting = async (hostId: string, organizationId?: string) => {
  let code: string;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
    if (attempts > 10) throw new ApiError(500, 'Failed to generate unique meeting code');
  } while (await prisma.meeting.findUnique({ where: { code }, select: { id: true } }));

  if (organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, ownerId: true },
    });
    if (!org) {
      throw new ApiError(404, 'Organization not found');
    }
    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: hostId,
        },
      },
    });
    if (!member && org.ownerId !== hostId) {
      throw new ApiError(403, 'You do not have permission to create meetings for this organization');
    }
  }

  const meeting = await prisma.meeting.create({
    data: {
      code,
      hostId,
      organizationId: organizationId || null,
      waitingRoom: true,
      status: MeetingStatus.ACTIVE,
      admitted: [hostId],
      scopeType: organizationId ? MeetingScopeType.ORGANIZATION : MeetingScopeType.PERSONAL,

    },
  });

  return {
    code: meeting.code,
    organizationId: meeting.organizationId,
    link: `${env.CLIENT_URL}/meet/${meeting.code}`,
  };
};

export interface CreateScopedMeetingInput {
  title?: string;
  scopeType?: MeetingScopeType;
  organizationId?: string;
  teamId?: string;
  scheduledStartTime?: Date | string;
}

export const createScopedMeeting = async (
  hostId: string,
  input: CreateScopedMeetingInput
) => {
  const scopeType = input.scopeType || MeetingScopeType.PERSONAL;

  const permCheck = await canUserCreateMeeting(hostId, {
    scopeType,
    organizationId: input.organizationId,
    teamId: input.teamId,
    scheduledStartTime: input.scheduledStartTime,
  });

  if (!permCheck.allowed) {
    throw new ApiError(permCheck.statusCode || 403, permCheck.reason || 'Permission denied');
  }

  let code: string;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
    if (attempts > 10) throw new ApiError(500, 'Failed to generate unique meeting code');
  } while (await prisma.meeting.findUnique({ where: { code }, select: { id: true } }));


  const scheduledDate = input.scheduledStartTime
    ? new Date(input.scheduledStartTime)
    : null;

  const isFutureScheduled = scheduledDate && scheduledDate.getTime() > Date.now();
  const status = isFutureScheduled ? MeetingStatus.SCHEDULED : MeetingStatus.ACTIVE;

  const meeting = await prisma.meeting.create({
    data: {
      code,
      title: input.title?.trim() || null,
      hostId,
      scopeType,
      organizationId: input.organizationId || null,
      teamId: input.teamId || null,
      scheduledStartTime: scheduledDate,
      waitingRoom: true,
      status,
      admitted: [hostId],
    },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      team: { select: { id: true, name: true, organizationId: true } },
    },
  });

  return {
    code: meeting.code,
    title: meeting.title,
    scopeType: meeting.scopeType,
    status: meeting.status,
    scheduledStartTime: meeting.scheduledStartTime,
    organizationId: meeting.organizationId,
    organization: meeting.organization,
    teamId: meeting.teamId,
    team: meeting.team,
    link: `${env.CLIENT_URL}/meet/${meeting.code}`,
  };
};

export const getMeeting = async (code: string, userId?: string) => {
  if (userId) {
    const permCheck = await canUserJoinMeeting(userId, code);
    if (!permCheck.allowed) {
      throw new ApiError(permCheck.statusCode || 403, permCheck.reason || 'Access denied');
    }
  }

  const meeting = await prisma.meeting.findFirst({
    where: {
      code,
      status: {
        in: [MeetingStatus.ACTIVE, MeetingStatus.SCHEDULED],
      },
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      team: {
        select: {
          id: true,
          name: true,
          organizationId: true,
        },
      },
    },
  });

  if (!meeting) {
    throw new ApiError(404, 'Meeting not found or already ended');
  }

  if (meeting.scopeType !== MeetingScopeType.PERSONAL && !userId) {
    throw new ApiError(401, 'Authentication required to access this meeting');
  }


  return {
    code: meeting.code,
    title: meeting.title,
    scopeType: meeting.scopeType,
    status: meeting.status,
    scheduledStartTime: meeting.scheduledStartTime,
    waitingRoom: meeting.waitingRoom,
    hostId: meeting.hostId,
    host: meeting.host,
    organizationId: meeting.organizationId,
    organization: meeting.organization,
    teamId: meeting.teamId,
    team: meeting.team,
  };
};

export const endMeeting = async (code: string, hostId: string) => {
  const meeting = await prisma.meeting.findFirst({
    where: { code },
  });

  if (!meeting) {
    throw new ApiError(404, 'Meeting not found');
  }

  if (meeting.status === MeetingStatus.ENDED) {
    throw new ApiError(400, 'Meeting has already ended');
  }

  if (meeting.hostId !== hostId) {
    throw new ApiError(403, 'Only the host can end this meeting');
  }

  await prisma.meeting.update({
    where: { code },
    data: { status: MeetingStatus.ENDED },
  });

  try {
    closeMeetingRoom(code);
  } catch (err) {
    console.error('Failed to teardown meeting socket room:', err);
  }

  return { message: 'Meeting ended successfully' };
};

export const getOrganizationMeetings = async (
  organizationId: string,
  userId: string
) => {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, ownerId: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId,
      },
    },
  });

  if (!member && org.ownerId !== userId) {
    throw new ApiError(403, 'You do not have access to this organization\'s meetings');
  }

  const meetings = await prisma.meeting.findMany({
    where: {
      organizationId,
      scopeType: MeetingScopeType.ORGANIZATION,
      status: {
        in: [MeetingStatus.ACTIVE, MeetingStatus.SCHEDULED],
      },
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
      team: {
        select: {
          id: true,
          name: true,
          organizationId: true,
        },
      },
    },
    orderBy: [
      { status: 'asc' },
      { scheduledStartTime: 'asc' },
      { createdAt: 'desc' },
    ],
  });

  return meetings.map((m) => ({
    code: m.code,
    title: m.title,
    scopeType: m.scopeType,
    status: m.status,
    scheduledStartTime: m.scheduledStartTime,
    host: m.host,
    team: m.team,
    link: `${env.CLIENT_URL}/meet/${m.code}`,
  }));
};

export const getTeamMeetings = async (teamId: string, userId: string) => {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      organizationId: true,
      organization: {
        select: {
          ownerId: true,
        },
      },
    },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found');
  }

  const teamMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  });

  let isOrgAdmin = false;
  if (!teamMember) {
    if (team.organization.ownerId === userId) {
      isOrgAdmin = true;
    } else {
      const orgMember = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: team.organizationId,
            userId,
          },
        },
      });
      if (orgMember?.role === OrgRole.ORG_ADMIN) {
        isOrgAdmin = true;
      }
    }
  }

  if (!teamMember && !isOrgAdmin) {
    throw new ApiError(403, 'You do not have access to this team\'s meetings');
  }

  const meetings = await prisma.meeting.findMany({
    where: {
      teamId,
      scopeType: MeetingScopeType.TEAM,
      status: {
        in: [MeetingStatus.ACTIVE, MeetingStatus.SCHEDULED],
      },
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
      team: {
        select: {
          id: true,
          name: true,
          organizationId: true,
        },
      },
    },
    orderBy: [
      { status: 'asc' },
      { scheduledStartTime: 'asc' },
      { createdAt: 'desc' },
    ],
  });

  return meetings.map((m) => ({
    code: m.code,
    title: m.title,
    scopeType: m.scopeType,
    status: m.status,
    scheduledStartTime: m.scheduledStartTime,
    host: m.host,
    team: m.team,
    link: `${env.CLIENT_URL}/meet/${m.code}`,
  }));
};

export const getUserUpcomingMeetings = async (userId: string) => {
  const orgMemberships = await prisma.organizationMember.findMany({
    where: { userId },
    select: { organizationId: true },
  });

  const ownedOrgs = await prisma.organization.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });

  const allOrgIds = Array.from(
    new Set([...orgMemberships.map((m) => m.organizationId), ...ownedOrgs.map((o) => o.id)])
  );

  const teamMemberships = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const teamIds = teamMemberships.map((m) => m.teamId);

  const nowMinus15Min = new Date(Date.now() - 15 * 60 * 1000);
  const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);


  const meetings = await prisma.meeting.findMany({
    where: {
      status: {
        in: [MeetingStatus.ACTIVE, MeetingStatus.SCHEDULED],
      },
      OR: [
        { hostId: userId },
        ...(allOrgIds.length > 0
          ? [
            {
              scopeType: MeetingScopeType.ORGANIZATION,
              organizationId: { in: allOrgIds },
            },
          ]
          : []),
        ...(teamIds.length > 0
          ? [
            {
              scopeType: MeetingScopeType.TEAM,
              teamId: { in: teamIds },
            },
          ]
          : []),
      ],
      AND: [
        {
          OR: [
            { status: MeetingStatus.ACTIVE },
            {
              status: MeetingStatus.SCHEDULED,
              OR: [
                { scheduledStartTime: { gte: nowMinus15Min, lte: thirtyDaysAhead } },
                { scheduledStartTime: null },
              ],
            },
          ],
        },
      ],
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      team: {
        select: {
          id: true,
          name: true,
          organizationId: true,
        },
      },
    },
    orderBy: [
      { status: 'asc' },
      { scheduledStartTime: 'asc' },
      { createdAt: 'desc' },
    ],
  });

  return meetings.map((m) => ({
    code: m.code,
    title: m.title,
    scopeType: m.scopeType,
    status: m.status,
    scheduledStartTime: m.scheduledStartTime,
    host: m.host,
    organization: m.organization,
    team: m.team,
    link: `${env.CLIENT_URL}/meet/${m.code}`,
  }));
};
