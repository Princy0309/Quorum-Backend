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

export const createMeeting = async (hostId: string) => {
  let code: string;
  do {
    code = generateCode();
  } while (await prisma.meeting.findUnique({ where: { code } }));

  const meeting = await prisma.meeting.create({
    data: {
      code,
      hostId,
      waitingRoom: true,
      status: MeetingStatus.ACTIVE,
      admitted: [hostId],
    },
  });

  return {
    code: meeting.code,
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
          email: true,
          avatar: true,
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
    admitted: meeting.admitted,
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
