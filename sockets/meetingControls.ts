import { Server, Socket } from 'socket.io';
import { meetingRooms } from './meetingPresence.js';

export const handleToggleMic = (io: Server, socket: Socket, payload: { meetingCode: string; isMuted: boolean }) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    socket.emit('meeting:error', { message: 'Unauthorized' });
    return;
  }

  const { meetingCode, isMuted } = payload || {};
  if (!meetingCode || typeof isMuted !== 'boolean') {
    socket.emit('meeting:error', { message: 'Meeting code and isMuted status are required' });
    return;
  }

  const roomState = meetingRooms.get(meetingCode);
  if (!roomState) {
    socket.emit('meeting:error', { message: 'Meeting room not found' });
    return;
  }

  if (!roomState.participants.has(user.id)) {
    socket.emit('meeting:error', { message: 'You are not an active participant in this meeting' });
    return;
  }

  io.to(meetingCode).emit('meeting:participant-mic-status', {
    userId: user.id,
    socketId: socket.id,
    isMuted,
  });
};

export const handleToggleCam = (io: Server, socket: Socket, payload: { meetingCode: string; isVideoOff: boolean }) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    socket.emit('meeting:error', { message: 'Unauthorized' });
    return;
  }

  const { meetingCode, isVideoOff } = payload || {};
  if (!meetingCode || typeof isVideoOff !== 'boolean') {
    socket.emit('meeting:error', { message: 'Meeting code and isVideoOff status are required' });
    return;
  }

  const roomState = meetingRooms.get(meetingCode);
  if (!roomState) {
    socket.emit('meeting:error', { message: 'Meeting room not found' });
    return;
  }

  if (!roomState.participants.has(user.id)) {
    socket.emit('meeting:error', { message: 'You are not an active participant in this meeting' });
    return;
  }

  io.to(meetingCode).emit('meeting:participant-cam-status', {
    userId: user.id,
    socketId: socket.id,
    isVideoOff,
  });
};
