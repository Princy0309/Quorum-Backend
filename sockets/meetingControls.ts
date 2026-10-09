import { Server, Socket } from 'socket.io';
import { meetingRooms, SocketAckResponse } from './meetingPresence.js';
import { peerConnectionManager } from '../sfu/peerConnection.js';

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

  const participant = roomState.participants.get(user.id);
  if (!participant || !participant.socketIds.has(socket.id)) {
    const err = { code: 'NOT_ACTIVE_PARTICIPANT', message: 'You are not an active participant in this meeting' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  if (!isMuted && participant.hostMuted) {
    const err = { code: 'HOST_MUTED', message: 'You have been muted by the host and cannot unmute yourself' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  participant.isMuted = isMuted;
  peerConnectionManager.setPeerMuteStatus(normalizedCode, user.id, isMuted);

  io.to(normalizedCode).emit('meeting:participant-mic-status', {
    userId: user.id,
    socketId: socket.id,
    isMuted,
    hostMuted: participant.hostMuted ?? false,
  });

  ack?.({ success: true, data: { isMuted, hostMuted: participant.hostMuted ?? false } });
};

export const handleMuteParticipant = (
  io: Server,
  socket: Socket,
  payload: { meetingCode: string; targetUserId: string; allowUnmute?: boolean; action?: 'mute' | 'allow-unmute' | 'unmute' },
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode, targetUserId, allowUnmute, action } = payload || {};
  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';

  if (!normalizedCode || typeof targetUserId !== 'string' || !targetUserId.trim()) {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code and target user ID are required' };
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

  const hostParticipant = roomState.participants.get(user.id);
  if (roomState.hostUserId !== user.id || !hostParticipant || !hostParticipant.socketIds.has(socket.id)) {
    const err = { code: 'NOT_MEETING_HOST', message: 'Only the host can mute participants' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const targetParticipant = roomState.participants.get(targetUserId.trim());
  if (!targetParticipant) {
    const err = { code: 'PARTICIPANT_NOT_FOUND', message: 'Participant not found in meeting' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  if (action === 'allow-unmute' || action === 'unmute' || allowUnmute === true) {
    targetParticipant.hostMuted = false;

    targetParticipant.socketIds.forEach((sId) => {
      io.to(sId).emit('meeting:permitted-to-unmute', {
        meetingCode: normalizedCode,
      });
    });

    io.to(normalizedCode).emit('meeting:participant-mic-status', {
      userId: targetUserId.trim(),
      isMuted: targetParticipant.isMuted ?? true,
      hostMuted: false,
      permittedToUnmute: true,
    });

    ack?.({
      success: true,
      data: {
        targetUserId: targetUserId.trim(),
        isMuted: targetParticipant.isMuted ?? true,
        hostMuted: false,
        permittedToUnmute: true,
      },
    });
    return;
  }

  targetParticipant.isMuted = true;
  targetParticipant.hostMuted = true;

  targetParticipant.socketIds.forEach((sId) => {
    io.to(sId).emit('meeting:force-mute', {
      meetingCode: normalizedCode,
      mutedBy: user.id,
    });
  });

  peerConnectionManager.setPeerMuteStatus(normalizedCode, targetUserId.trim(), true);

  io.to(normalizedCode).emit('meeting:participant-mic-status', {
    userId: targetUserId.trim(),
    isMuted: true,
    hostMuted: true,
    enforcedByHost: true,
  });

  ack?.({ success: true, data: { targetUserId: targetUserId.trim(), isMuted: true, hostMuted: true } });
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

  const participant = roomState.participants.get(user.id);
  if (!participant || !participant.socketIds.has(socket.id)) {
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

  const participant = roomState.participants.get(user.id);
  if (!participant || !participant.socketIds.has(socket.id)) {
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
