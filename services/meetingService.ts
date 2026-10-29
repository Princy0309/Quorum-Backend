import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { MeetingScopeType, MeetingStatus } from '@prisma/client';
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
  do {
    code = generateCode();
  } while (await prisma.meeting.findUnique({ where: { code } }));

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
  do {
    code = generateCode();
  } while (await prisma.meeting.findUnique({ where: { code } }));

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
      team: { select: { id: true, name: true } },
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
        },
      },
    },
  });

  if (!meeting) {
    throw new ApiError(404, 'Meeting not found or already ended');
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
