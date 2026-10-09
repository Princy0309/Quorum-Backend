import { Server, Socket } from 'socket.io';
import { meetingRooms, SocketAckResponse } from './meetingPresence.js';

export const handleToggleMic = (
  io: Server,
  socket: Socket,
  payload: { meetingCode: string; isMuted: boolean },
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode, isMuted } = payload || {};
  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';

  if (!normalizedCode || typeof isMuted !== 'boolean') {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code and isMuted status are required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const roomState = meetingRooms.get(normalizedCode);
  if (!roomState) {
    const err = { code: 'MEETING_NOT_FOUND', message: 'Meeting room not found' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  if (!roomState.participants.has(user.id)) {
    const err = { code: 'NOT_ACTIVE_PARTICIPANT', message: 'You are not an active participant in this meeting' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  io.to(normalizedCode).emit('meeting:participant-mic-status', {
    userId: user.id,
    socketId: socket.id,
    isMuted,
  });

  ack?.({ success: true, data: { isMuted } });
};

export const handleToggleCam = (
  io: Server,
  socket: Socket,
  payload: { meetingCode: string; isVideoOff: boolean },
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode, isVideoOff } = payload || {};
  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';

  if (!normalizedCode || typeof isVideoOff !== 'boolean') {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code and isVideoOff status are required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const roomState = meetingRooms.get(normalizedCode);
  if (!roomState) {
    const err = { code: 'MEETING_NOT_FOUND', message: 'Meeting room not found' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  if (!roomState.participants.has(user.id)) {
    const err = { code: 'NOT_ACTIVE_PARTICIPANT', message: 'You are not an active participant in this meeting' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  io.to(normalizedCode).emit('meeting:participant-cam-status', {
    userId: user.id,
    socketId: socket.id,
    isVideoOff,
  });

  ack?.({ success: true, data: { isVideoOff } });
};

export const handleSendMeetingMessage = (
  io: Server,
  socket: Socket,
  payload: { meetingCode: string; content: string },
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode, content } = payload || {};
  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';

  if (!normalizedCode || !content || typeof content !== 'string' || !content.trim()) {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code and non-empty message content are required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const roomState = meetingRooms.get(normalizedCode);
  if (!roomState) {
    const err = { code: 'MEETING_NOT_FOUND', message: 'Meeting room not found' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  if (!roomState.participants.has(user.id)) {
    const err = { code: 'NOT_ACTIVE_PARTICIPANT', message: 'You are not an active participant in this meeting' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const messagePayload = {
    senderId: user.id,
    senderName: user.name || 'Participant',
    content: content.trim(),
    timestamp: new Date(),
  };

  io.to(normalizedCode).emit('meeting:new-message', messagePayload);

  ack?.({ success: true, data: messagePayload });
};
