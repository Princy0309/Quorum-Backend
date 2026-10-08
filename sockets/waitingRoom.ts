import { Server, Socket } from 'socket.io';
import { meetingRooms, Participant } from './meetingPresence.js';

export const handleAdmitParticipant = (io: Server, socket: Socket, payload: { meetingCode: string; targetUserId: string }) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    socket.emit('meeting:error', { message: 'Unauthorized' });
    return;
  }

  const { meetingCode, targetUserId } = payload || {};
  if (!meetingCode || !targetUserId) {
    socket.emit('meeting:error', { message: 'Meeting code and target user ID are required' });
    return;
  }

  const roomState = meetingRooms.get(meetingCode);
  if (!roomState) {
    socket.emit('meeting:error', { message: 'Meeting not found' });
    return;
  }

  if (roomState.hostUserId !== user.id) {
    socket.emit('meeting:error', { message: 'Only the host can admit participants' });
    return;
  }

  const waitingUser = roomState.waitingRoom.get(targetUserId);
  if (!waitingUser) {
    socket.emit('meeting:error', { message: 'User is not in the waiting room' });
    return;
  }

  roomState.waitingRoom.delete(targetUserId);

  const newParticipant: Participant = {
    userId: waitingUser.userId,
    name: waitingUser.name,
    socketId: waitingUser.socketId,
    role: 'participant',
    joinedAt: new Date(),
  };

  roomState.participants.set(targetUserId, newParticipant);

  const targetSocket = io.sockets.sockets.get(waitingUser.socketId);
  if (targetSocket) {
    targetSocket.join(meetingCode);
    targetSocket.emit('meeting:admitted', {
      meetingCode,
      role: 'participant',
      participants: Array.from(roomState.participants.values()),
    });
  }

  const activeParticipants = Array.from(roomState.participants.values());

  socket.to(meetingCode).emit('meeting:participant-joined', {
    participant: newParticipant,
    participants: activeParticipants,
  });

  io.to(meetingCode).emit('meeting:presence-update', {
    participants: activeParticipants,
  });
};

export const handleRejectParticipant = (io: Server, socket: Socket, payload: { meetingCode: string; targetUserId: string }) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    socket.emit('meeting:error', { message: 'Unauthorized' });
    return;
  }

  const { meetingCode, targetUserId } = payload || {};
  if (!meetingCode || !targetUserId) {
    socket.emit('meeting:error', { message: 'Meeting code and target user ID are required' });
    return;
  }

  const roomState = meetingRooms.get(meetingCode);
  if (!roomState) {
    socket.emit('meeting:error', { message: 'Meeting not found' });
    return;
  }

  if (roomState.hostUserId !== user.id) {
    socket.emit('meeting:error', { message: 'Only the host can reject participants' });
    return;
  }

  const waitingUser = roomState.waitingRoom.get(targetUserId);
  if (!waitingUser) {
    socket.emit('meeting:error', { message: 'User is not in the waiting room' });
    return;
  }

  roomState.waitingRoom.delete(targetUserId);

  const targetSocket = io.sockets.sockets.get(waitingUser.socketId);
  if (targetSocket) {
    targetSocket.emit('meeting:rejected', {
      meetingCode,
      message: 'The host has declined your request to join the meeting.',
    });
  }
};
