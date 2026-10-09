import { Server, Socket } from 'socket.io';
import { meetingRooms, formatParticipants, socketToMeetingsMap, ParticipantDTO, SocketAckResponse } from './meetingPresence.js';

export const handleAdmitParticipant = (
  io: Server,
  socket: Socket,
  payload: { meetingCode: string; targetUserId: string },
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode, targetUserId } = payload || {};
  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';

  if (!normalizedCode || typeof targetUserId !== 'string' || !targetUserId.trim()) {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code and target user ID are required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const roomState = meetingRooms.get(normalizedCode);
  if (!roomState) {
    const err = { code: 'MEETING_NOT_FOUND', message: 'Meeting not found' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const hostParticipant = roomState.participants.get(user.id);
  if (roomState.hostUserId !== user.id || !hostParticipant || !hostParticipant.socketIds.has(socket.id)) {
    const err = { code: 'NOT_MEETING_HOST', message: 'Only the host can admit participants' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const waitingUser = roomState.waitingRoom.get(targetUserId.trim());
  if (!waitingUser) {
    const err = { code: 'PARTICIPANT_NOT_FOUND', message: 'User is not in the waiting room' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const activeSocketIds = Array.from(waitingUser.socketIds).filter((sId) => {
    const s = io.sockets.sockets.get(sId);
    return s && s.connected;
  });

  if (activeSocketIds.length === 0) {
    roomState.waitingRoom.delete(targetUserId.trim());
    const err = { code: 'PARTICIPANT_DISCONNECTED', message: 'Participant is no longer connected' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  roomState.waitingRoom.delete(targetUserId.trim());

  const existingParticipant = roomState.participants.get(targetUserId.trim());
  if (existingParticipant) {
    activeSocketIds.forEach((sId) => existingParticipant.socketIds.add(sId));
  } else {
    roomState.participants.set(targetUserId.trim(), {
      userId: waitingUser.userId,
      name: waitingUser.name,
      socketIds: new Set(activeSocketIds),
      role: 'participant',
      joinedAt: new Date(),
    });
  }

  const activeParticipants = formatParticipants(roomState.participants);
  const admittedParticipant = roomState.participants.get(targetUserId.trim())!;

  const participantSummary: ParticipantDTO = {
    userId: admittedParticipant.userId,
    name: admittedParticipant.name,
    role: admittedParticipant.role,
    joinedAt: admittedParticipant.joinedAt,
  };

  activeSocketIds.forEach((sId) => {
    const targetSocket = io.sockets.sockets.get(sId);
    if (targetSocket && targetSocket.connected) {
      const socketMeetings = socketToMeetingsMap.get(sId) || new Set();
      socketMeetings.add(normalizedCode);
      socketToMeetingsMap.set(sId, socketMeetings);

      targetSocket.join(normalizedCode);
      targetSocket.emit('meeting:admitted', {
        meetingCode: normalizedCode,
        role: 'participant',
        participants: activeParticipants,
      });
    }
  });

  socket.to(normalizedCode).emit('meeting:participant-joined', {
    participant: participantSummary,
    participants: activeParticipants,
  });

  io.to(normalizedCode).emit('meeting:presence-update', {
    participants: activeParticipants,
  });

  ack?.({ success: true, data: { admittedUserId: targetUserId.trim() } });
};

export const handleRejectParticipant = (
  io: Server,
  socket: Socket,
  payload: { meetingCode: string; targetUserId: string },
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode, targetUserId } = payload || {};
  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';

  if (!normalizedCode || typeof targetUserId !== 'string' || !targetUserId.trim()) {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code and target user ID are required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const roomState = meetingRooms.get(normalizedCode);
  if (!roomState) {
    const err = { code: 'MEETING_NOT_FOUND', message: 'Meeting not found' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const hostParticipant = roomState.participants.get(user.id);
  if (roomState.hostUserId !== user.id || !hostParticipant || !hostParticipant.socketIds.has(socket.id)) {
    const err = { code: 'NOT_MEETING_HOST', message: 'Only the host can reject participants' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const waitingUser = roomState.waitingRoom.get(targetUserId.trim());
  if (!waitingUser) {
    const err = { code: 'PARTICIPANT_NOT_FOUND', message: 'User is not in the waiting room' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const activeSocketIds = Array.from(waitingUser.socketIds);
  roomState.waitingRoom.delete(targetUserId.trim());

  activeSocketIds.forEach((sId) => {
    const targetSocket = io.sockets.sockets.get(sId);
    if (targetSocket && targetSocket.connected) {
      targetSocket.emit('meeting:rejected', {
        meetingCode: normalizedCode,
        message: 'The host has declined your request to join the meeting.',
      });
    }
  });

  ack?.({ success: true, data: { rejectedUserId: targetUserId.trim() } });
};
