import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { MeetingPollStatus, MeetingStatus } from '@prisma/client';
import { getIO } from '../sockets/socketServer.js';
import { meetingRooms, normalizeMeetingCode } from '../sockets/meetingPresence.js';
import { canUserJoinMeeting } from './meetingPermissionService.js';
import logger from '../utils/logger.js';
import { CreateMeetingPollInput } from '../validators/meetingValidators.js';

export const formatMeetingPoll = (poll: any, requestingUserId?: string) => {
  if (!poll) return null;

  const totalVotes = Array.isArray(poll.options)
    ? poll.options.reduce((acc: number, opt: any) => acc + (Array.isArray(opt.votes) ? opt.votes.length : 0), 0)
    : 0;

  const uniqueVoterIds = new Set<string>();
  if (Array.isArray(poll.options)) {
    for (const opt of poll.options) {
      if (Array.isArray(opt.votes)) {
        for (const vote of opt.votes) {
          if (vote?.userId) uniqueVoterIds.add(vote.userId);
        }
      }
    }
  }

  const userVotedOptionIds: string[] = [];
  if (requestingUserId && Array.isArray(poll.options)) {
    for (const opt of poll.options) {
      if (Array.isArray(opt.votes) && opt.votes.some((v: any) => v.userId === requestingUserId)) {
        userVotedOptionIds.push(opt.id);
      }
    }
  }

  const formattedOptions = Array.isArray(poll.options)
    ? poll.options
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((opt: any) => {
          const voteCount = Array.isArray(opt.votes) ? opt.votes.length : 0;
          const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
          const hasVoted = Boolean(requestingUserId && opt.votes?.some((v: any) => v.userId === requestingUserId));
          const voters = poll.isAnonymous
            ? []
            : (opt.votes || []).map((v: any) => ({
                userId: v.userId,
                createdAt: v.createdAt,
                user: v.user ? { id: v.user.id, name: v.user.name, avatar: v.user.avatar } : undefined,
              }));

          return {
            id: opt.id,
            pollId: opt.pollId,
            text: opt.text,
            order: opt.order,
            voteCount,
            percentage,
            hasVoted,
            voters,
          };
        })
    : [];

  return {
    id: poll.id,
    meetingId: poll.meetingId,
    creatorId: poll.creatorId,
    creator: poll.creator ? { id: poll.creator.id, name: poll.creator.name, avatar: poll.creator.avatar } : undefined,
    question: poll.question,
    allowMultipleAnswers: poll.allowMultipleAnswers,
    isAnonymous: poll.isAnonymous,
    status: poll.status,
    totalVotes,
    uniqueVotersCount: uniqueVoterIds.size,
    hasVoted: userVotedOptionIds.length > 0,
    userVotedOptionIds,
    options: formattedOptions,
    createdAt: poll.createdAt,
    updatedAt: poll.updatedAt,
    closedAt: poll.closedAt,
  };
};

export const assertUserCanParticipateInMeeting = async (userId: string, meetingCode: string) => {
  const cleanCode = normalizeMeetingCode(meetingCode);
  const roomState = meetingRooms.get(cleanCode);

  if (roomState?.participants.has(userId)) {
    return cleanCode;
  }

  const check = await canUserJoinMeeting(userId, cleanCode);
  if (!check.allowed) {
    throw new ApiError(check.statusCode || 403, check.reason || 'You are not permitted to participate in this meeting');
  }

  return cleanCode;
};

export const createMeetingPoll = async (
  userId: string,
  meetingCode: string,
  input: CreateMeetingPollInput
) => {
  const cleanCode = await assertUserCanParticipateInMeeting(userId, meetingCode);

  const meeting = await prisma.meeting.findFirst({
    where: {
      code: cleanCode,
      status: { in: [MeetingStatus.ACTIVE, MeetingStatus.SCHEDULED] },
    },
    select: { id: true, code: true },
  });

  if (!meeting) {
    throw new ApiError(404, 'Active meeting not found');
  }

  const poll = await prisma.meetingPoll.create({
    data: {
      meetingId: meeting.id,
      creatorId: userId,
      question: input.question.trim(),
      allowMultipleAnswers: Boolean(input.allowMultipleAnswers),
      isAnonymous: Boolean(input.isAnonymous),
      options: {
        create: input.options.map((optText, index) => ({
          text: optText.trim(),
          order: index,
        })),
      },
    },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      options: {
        include: {
          votes: {
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
        },
      },
    },
  });

  const formattedPublic = formatMeetingPoll(poll);
  try {
    const io = getIO();
    io.to(cleanCode).emit('meeting:poll-created', {
      meetingCode: cleanCode,
      poll: formattedPublic,
    });
  } catch (err: any) {
    logger.error('Failed to emit meeting:poll-created event', { error: err.message, meetingCode: cleanCode });
  }

  return formatMeetingPoll(poll, userId);
};

export const voteMeetingPoll = async (
  userId: string,
  meetingCode: string,
  pollId: string,
  optionIds: string[]
) => {
  const cleanCode = await assertUserCanParticipateInMeeting(userId, meetingCode);

  const poll = await prisma.meetingPoll.findFirst({
    where: {
      id: pollId,
      meeting: { code: cleanCode },
    },
    include: {
      options: true,
      meeting: { select: { id: true, code: true } },
    },
  });

  if (!poll) {
    throw new ApiError(404, 'Poll not found in this meeting');
  }

  if (poll.status !== MeetingPollStatus.ACTIVE) {
    throw new ApiError(400, 'This poll is closed for voting');
  }

  const validOptionIds = new Set(poll.options.map((o) => o.id));
  const invalid = optionIds.filter((id) => !validOptionIds.has(id));
  if (invalid.length > 0) {
    throw new ApiError(400, 'One or more selected option IDs are invalid for this poll');
  }

  if (!poll.allowMultipleAnswers && optionIds.length > 1) {
    throw new ApiError(400, 'This poll only allows single choice voting');
  }

  await prisma.$transaction(async (tx) => {
    if (!poll.allowMultipleAnswers) {
      const selectedOptionId = optionIds[0];
      const existingVote = await tx.meetingPollVote.findFirst({
        where: {
          userId,
          option: { pollId: poll.id },
        },
      });

      if (existingVote && existingVote.pollOptionId === selectedOptionId) {
        await tx.meetingPollVote.delete({ where: { id: existingVote.id } });
      } else {
        if (existingVote) {
          await tx.meetingPollVote.delete({ where: { id: existingVote.id } });
        }
        await tx.meetingPollVote.create({
          data: {
            pollOptionId: selectedOptionId,
            userId,
          },
        });
      }
    } else {
      for (const targetOptionId of optionIds) {
        const existingVote = await tx.meetingPollVote.findUnique({
          where: {
            pollOptionId_userId: {
              pollOptionId: targetOptionId,
              userId,
            },
          },
        });

        if (existingVote) {
          await tx.meetingPollVote.delete({ where: { id: existingVote.id } });
        } else {
          await tx.meetingPollVote.create({
            data: {
              pollOptionId: targetOptionId,
              userId,
            },
          });
        }
      }
    }
  });

  const updatedPoll = await prisma.meetingPoll.findUnique({
    where: { id: poll.id },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      options: {
        include: {
          votes: {
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
        },
      },
    },
  });

  const formattedPublic = formatMeetingPoll(updatedPoll);
  try {
    const io = getIO();
    io.to(cleanCode).emit('meeting:poll-updated', {
      meetingCode: cleanCode,
      poll: formattedPublic,
    });
  } catch (err: any) {
    logger.error('Failed to emit meeting:poll-updated event', { error: err.message, meetingCode: cleanCode });
  }

  return formatMeetingPoll(updatedPoll, userId);
};

export const closeMeetingPoll = async (
  userId: string,
  meetingCode: string,
  pollId: string
) => {
  const cleanCode = await assertUserCanParticipateInMeeting(userId, meetingCode);

  const poll = await prisma.meetingPoll.findFirst({
    where: {
      id: pollId,
      meeting: { code: cleanCode },
    },
  });

  if (!poll) {
    throw new ApiError(404, 'Poll not found in this meeting');
  }

  if (poll.status === MeetingPollStatus.CLOSED) {
    throw new ApiError(400, 'Poll is already closed');
  }

  const closedPoll = await prisma.meetingPoll.update({
    where: { id: poll.id },
    data: {
      status: MeetingPollStatus.CLOSED,
      closedAt: new Date(),
    },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      options: {
        include: {
          votes: {
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
        },
      },
    },
  });

  const formattedPublic = formatMeetingPoll(closedPoll);
  try {
    const io = getIO();
    io.to(cleanCode).emit('meeting:poll-closed', {
      meetingCode: cleanCode,
      pollId: closedPoll.id,
      poll: formattedPublic,
    });
  } catch (err: any) {
    logger.error('Failed to emit meeting:poll-closed event', { error: err.message, meetingCode: cleanCode });
  }

  return formatMeetingPoll(closedPoll, userId);
};

export const getMeetingPolls = async (userId: string, meetingCode: string) => {
  const cleanCode = await assertUserCanParticipateInMeeting(userId, meetingCode);

  const polls = await prisma.meetingPoll.findMany({
    where: {
      meeting: { code: cleanCode },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      options: {
        include: {
          votes: {
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
        },
      },
    },
  });

  return polls.map((p) => formatMeetingPoll(p, userId));
};
