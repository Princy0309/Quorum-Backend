import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { MeetingStatus } from '@prisma/client';
import { closeMeetingRoom } from '../sockets/meetingPresence.js';


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

export const getMeeting = async (code: string) => {
  const meeting = await prisma.meeting.findFirst({
    where: {
      code,
      status: MeetingStatus.ACTIVE,
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
    },
  });

  if (!meeting) {
    throw new ApiError(404, 'Meeting not found or already ended');
  }

  return {
    code: meeting.code,
    waitingRoom: meeting.waitingRoom,
    hostId: meeting.hostId,
    host: meeting.host,
    organizationId: meeting.organizationId,
    organization: meeting.organization,
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
