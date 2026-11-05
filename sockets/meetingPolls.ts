import { Server, Socket } from 'socket.io';
import { SocketAckResponse, normalizeMeetingCode } from './meetingPresence.js';
import {
  createMeetingPoll,
  voteMeetingPoll,
  closeMeetingPoll,
  getMeetingPolls,
} from '../services/meetingPollService.js';
import {
  createMeetingPollSchema,
  voteMeetingPollSchema,
} from '../validators/meetingValidators.js';
import logger from '../utils/logger.js';

export const handleCreateMeetingPoll = async (
  io: Server,
  socket: Socket,
  payload: any,
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id || !user.isAuthenticated) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode, ...pollData } = payload || {};
  const normalizedCode = normalizeMeetingCode(meetingCode);

  if (!normalizedCode) {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code is required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const parsed = createMeetingPollSchema.safeParse(pollData);
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ');
    const err = { code: 'VALIDATION_ERROR', message };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  try {
    const poll = await createMeetingPoll(user.id, normalizedCode, parsed.data);
    ack?.({ success: true, data: poll });
  } catch (err: any) {
    logger.error('Error creating meeting poll via socket', { error: err.message, meetingCode: normalizedCode });
    const responseErr = {
      code: err.code || 'SERVER_ERROR',
      message: err.message || 'Failed to create meeting poll',
    };
    socket.emit('meeting:error', responseErr);
    ack?.({ success: false, ...responseErr });
  }
};

export const handleVoteMeetingPoll = async (
  io: Server,
  socket: Socket,
  payload: any,
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id || !user.isAuthenticated) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode, pollId, optionIds } = payload || {};
  const normalizedCode = normalizeMeetingCode(meetingCode);

  if (!normalizedCode || !pollId) {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code and pollId are required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const parsed = voteMeetingPollSchema.safeParse({ optionIds });
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ');
    const err = { code: 'VALIDATION_ERROR', message };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  try {
    const poll = await voteMeetingPoll(user.id, normalizedCode, pollId, parsed.data.optionIds);
    ack?.({ success: true, data: poll });
  } catch (err: any) {
    logger.error('Error voting on meeting poll via socket', { error: err.message, meetingCode: normalizedCode });
    const responseErr = {
      code: err.code || 'SERVER_ERROR',
      message: err.message || 'Failed to record vote on meeting poll',
    };
    socket.emit('meeting:error', responseErr);
    ack?.({ success: false, ...responseErr });
  }
};

export const handleCloseMeetingPoll = async (
  io: Server,
  socket: Socket,
  payload: any,
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id || !user.isAuthenticated) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode, pollId } = payload || {};
  const normalizedCode = normalizeMeetingCode(meetingCode);

  if (!normalizedCode || !pollId) {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code and pollId are required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  try {
    const poll = await closeMeetingPoll(user.id, normalizedCode, pollId);
    ack?.({ success: true, data: poll });
  } catch (err: any) {
    logger.error('Error closing meeting poll via socket', { error: err.message, meetingCode: normalizedCode });
    const responseErr = {
      code: err.code || 'SERVER_ERROR',
      message: err.message || 'Failed to close meeting poll',
    };
    socket.emit('meeting:error', responseErr);
    ack?.({ success: false, ...responseErr });
  }
};

export const handleGetMeetingPolls = async (
  io: Server,
  socket: Socket,
  payload: any,
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id || !user.isAuthenticated) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode } = payload || {};
  const normalizedCode = normalizeMeetingCode(meetingCode);

  if (!normalizedCode) {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code is required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  try {
    const polls = await getMeetingPolls(user.id, normalizedCode);
    ack?.({ success: true, data: polls });
  } catch (err: any) {
    logger.error('Error getting meeting polls via socket', { error: err.message, meetingCode: normalizedCode });
    const responseErr = {
      code: err.code || 'SERVER_ERROR',
      message: err.message || 'Failed to fetch meeting polls',
    };
    socket.emit('meeting:error', responseErr);
    ack?.({ success: false, ...responseErr });
  }
};
