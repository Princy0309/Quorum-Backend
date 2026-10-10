import { Server, Socket } from 'socket.io';
import prisma from '../config/prisma.js';
import { MeetingStatus } from '@prisma/client';
import { getIO } from './socketServer.js';
import { roomBroker } from '../sfu/roomBroker.js';
import { peerConnectionManager } from '../sfu/peerConnection.js';
import { endMeeting } from '../services/meetingService.js';

export interface Participant {
  userId: string;
  name: string;
  socketIds: Set<string>;
  role: 'host' | 'participant';
  joinedAt: Date;
  isMuted?: boolean;
  hostMuted?: boolean;
  isVideoOff?: boolean;
}

export interface ParticipantDTO {
  userId: string;
  name: string;
  role: 'host' | 'participant';
  joinedAt: Date;
  isMuted?: boolean;
  hostMuted?: boolean;
  isVideoOff?: boolean;
}

export interface WaitingUser {
  userId: string;
  name: string;
  socketIds: Set<string>;
}

export interface MeetingRoomState {
  code: string;
  hostUserId: string;
  waitingRoomEnabled: boolean;
  participants: Map<string, Participant>;
  waitingRoom: Map<string, WaitingUser>;
}

export interface SocketAckResponse {
  success: boolean;
  code?: string;
  message?: string;
  data?: any;
}

export const meetingRooms = new Map<string, MeetingRoomState>();
export const socketToMeetingsMap = new Map<string, Set<string>>();
const meetingInitLocks = new Map<string, Promise<MeetingRoomState | null>>();

export const formatParticipants = (participantsMap: Map<string, Participant>): ParticipantDTO[] => {
  return Array.from(participantsMap.values()).map((p) => ({
    userId: p.userId,
    name: p.name,
    role: p.role,
    joinedAt: p.joinedAt,
    isMuted: p.isMuted ?? false,
    hostMuted: p.hostMuted ?? false,
    isVideoOff: p.isVideoOff ?? false,
  }));
};

export const getOrCreateMeetingState = async (meetingCode: string): Promise<MeetingRoomState | null> => {
  const existing = meetingRooms.get(meetingCode);
  if (existing) {
    return existing;
  }

  const pending = meetingInitLocks.get(meetingCode);
  if (pending) {
    return await pending;
  }

  const initPromise = (async () => {
    try {
      const dbMeeting = await prisma.meeting.findFirst({
        where: {
          code: meetingCode,
          status: MeetingStatus.ACTIVE,
        },
        select: {
          hostId: true,
          waitingRoom: true,
        },
      });

      if (!dbMeeting || !dbMeeting.hostId) {
        return null;
      }

      let state = meetingRooms.get(meetingCode);
      if (!state) {
        state = {
          code: meetingCode,
          hostUserId: dbMeeting.hostId,
          waitingRoomEnabled: dbMeeting.waitingRoom,
          participants: new Map(),
          waitingRoom: new Map(),
        };
        meetingRooms.set(meetingCode, state);
      }
      return state;
    } finally {
      meetingInitLocks.delete(meetingCode);
    }
  })();

  meetingInitLocks.set(meetingCode, initPromise);
  return await initPromise;
};

export const handleJoinMeeting = async (
  io: Server,
  socket: Socket,
  meetingCode: string,
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    const errorPayload = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', errorPayload);
    ack?.({ success: false, ...errorPayload });
    return;
  }

  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';
  if (!normalizedCode) {
    const errorPayload = { code: 'INVALID_PAYLOAD', message: 'Meeting code is required' };
    socket.emit('meeting:error', errorPayload);
    ack?.({ success: false, ...errorPayload });
    return;
  }

  let roomState: MeetingRoomState | null;
  try {
    roomState = await getOrCreateMeetingState(normalizedCode);
  } catch (dbErr: any) {
    console.error('Failed to validate meeting in database:', dbErr);
    const errorPayload = { code: 'SERVER_ERROR', message: 'Database error occurred while retrieving meeting' };
    socket.emit('meeting:error', errorPayload);
    ack?.({ success: false, ...errorPayload });
    return;
  }

  if (!roomState) {
    const errorPayload = { code: 'MEETING_NOT_FOUND', message: 'Meeting room not found or already ended' };
    socket.emit('meeting:error', errorPayload);
    ack?.({ success: false, ...errorPayload });
    return;
  }

  const isHost = roomState.hostUserId === user.id;

  if (!isHost && roomState.waitingRoomEnabled && !roomState.participants.has(user.id)) {
    let waitingUser = roomState.waitingRoom.get(user.id);
    if (waitingUser) {
      waitingUser.socketIds.add(socket.id);
    } else {
      waitingUser = {
        userId: user.id,
        name: user.name || 'Guest',
        socketIds: new Set([socket.id]),
      };
      roomState.waitingRoom.set(user.id, waitingUser);
    }

    const socketMeetings = socketToMeetingsMap.get(socket.id) || new Set();
    socketMeetings.add(normalizedCode);
    socketToMeetingsMap.set(socket.id, socketMeetings);

    const waitingPayload = {
      message: 'You are in the waiting room. Please wait for the host to admit you.',
      meetingCode: normalizedCode,
    };

    socket.emit('meeting:waiting-room', waitingPayload);
    ack?.({ success: true, data: { status: 'waiting_room', ...waitingPayload } });

    const hostParticipant = Array.from(roomState.participants.values()).find((p) => p.role === 'host');
    if (hostParticipant) {
      hostParticipant.socketIds.forEach((hostSocketId) => {
        io.to(hostSocketId).emit('meeting:guest-waiting', {
          user: {
            userId: waitingUser!.userId,
            name: waitingUser!.name,
            socketIds: Array.from(waitingUser!.socketIds),
          },
        });
      });
    }
    return;
  }

  const participantRole: 'host' | 'participant' = isHost ? 'host' : 'participant';
  const existingParticipant = roomState.participants.get(user.id);

  if (existingParticipant) {
    existingParticipant.socketIds.add(socket.id);
  } else {
    roomState.participants.set(user.id, {
      userId: user.id,
      name: user.name || 'Participant',
      socketIds: new Set([socket.id]),
      role: participantRole,
      joinedAt: new Date(),
      isMuted: false,
      hostMuted: false,
      isVideoOff: false,
    });
  }

  const socketMeetings = socketToMeetingsMap.get(socket.id) || new Set();
  socketMeetings.add(normalizedCode);
  socketToMeetingsMap.set(socket.id, socketMeetings);

  socket.join(normalizedCode);

  const activeParticipants = formatParticipants(roomState.participants);
  const waitingUsersList = Array.from(roomState.waitingRoom.values()).map((w) => ({
    userId: w.userId,
    name: w.name,
    socketIds: Array.from(w.socketIds),
  }));
  const currentParticipant = roomState.participants.get(user.id)!;

  const participantSummary: ParticipantDTO = {
    userId: currentParticipant.userId,
    name: currentParticipant.name,
    role: currentParticipant.role,
    joinedAt: currentParticipant.joinedAt,
    isMuted: currentParticipant.isMuted ?? false,
    hostMuted: currentParticipant.hostMuted ?? false,
    isVideoOff: currentParticipant.isVideoOff ?? false,
  };

  const joinedData = {
    meetingCode: normalizedCode,
    role: participantRole,
    participants: activeParticipants,
    waitingRoom: isHost ? waitingUsersList : [],
  };

  socket.emit('meeting:joined', joinedData);
  ack?.({ success: true, data: joinedData });

  if (!existingParticipant) {
    socket.to(normalizedCode).emit('meeting:participant-joined', {
      participant: participantSummary,
      participants: activeParticipants,
    });

    io.to(normalizedCode).emit('meeting:presence-update', {
      participants: activeParticipants,
    });
  }
};

export const handleLeaveMeeting = (
  io: Server,
  socket: Socket,
  meetingCode: string,
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    ack?.({ success: false, code: 'UNAUTHORIZED', message: 'Authentication required' });
    return;
  }

  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';
  if (!normalizedCode) {
    ack?.({ success: false, code: 'INVALID_PAYLOAD', message: 'Meeting code is required' });
    return;
  }

  const socketMeetings = socketToMeetingsMap.get(socket.id);
  if (socketMeetings) {
    socketMeetings.delete(normalizedCode);
    if (socketMeetings.size === 0) {
      socketToMeetingsMap.delete(socket.id);
    }
  }

  socket.leave(normalizedCode);
  roomBroker.removePeer(normalizedCode, socket.id);
  peerConnectionManager.closeConnection(normalizedCode, socket.id);

  const roomState = meetingRooms.get(normalizedCode);
  if (!roomState) {
    ack?.({ success: true });
    return;
  }

  const participant = roomState.participants.get(user.id);
  if (participant) {
    participant.socketIds.delete(socket.id);

    if (participant.socketIds.size === 0) {
      roomState.participants.delete(user.id);
      roomBroker.removePeersByUser(normalizedCode, user.id);

      const activeParticipants = formatParticipants(roomState.participants);
      io.to(normalizedCode).emit('meeting:participant-left', {
        userId: user.id,
        socketId: socket.id,
        participants: activeParticipants,
      });
      io.to(normalizedCode).emit('meeting:presence-update', {
        participants: activeParticipants,
      });
    }
  }

  const waitingUser = roomState.waitingRoom.get(user.id);
  if (waitingUser && waitingUser.socketIds.has(socket.id)) {
    waitingUser.socketIds.delete(socket.id);
    if (waitingUser.socketIds.size === 0) {
      roomState.waitingRoom.delete(user.id);
    }
  }

  if (roomState.participants.size === 0 && roomState.waitingRoom.size === 0) {
    meetingRooms.delete(normalizedCode);
  }

  ack?.({ success: true });
};

export const closeMeetingRoom = (meetingCode: string) => {
  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';
  if (!normalizedCode) return;

  const roomState = meetingRooms.get(normalizedCode);
  if (roomState) {
    try {
      const io = getIO();
      io.to(normalizedCode).emit('meeting:ended', {
        meetingCode: normalizedCode,
        message: 'The meeting has been ended by the host',
      });
      io.in(normalizedCode).socketsLeave(normalizedCode);
    } catch (err) {
      console.error('Failed to broadcast meeting ended event:', err);
    }
    meetingRooms.delete(normalizedCode);
  }

  roomBroker.closeRoom(normalizedCode);
  peerConnectionManager.closeRoomConnections(normalizedCode);

  for (const [socketId, meetings] of socketToMeetingsMap.entries()) {
    meetings.delete(normalizedCode);
    if (meetings.size === 0) {
      socketToMeetingsMap.delete(socketId);
    }
  }
};

export const handleEndMeeting = async (
  io: Server,
  socket: Socket,
  payload: { meetingCode: string },
  ack?: (res: SocketAckResponse) => void
) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    const err = { code: 'UNAUTHORIZED', message: 'Authentication required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const { meetingCode } = payload || {};
  const normalizedCode = typeof meetingCode === 'string' ? meetingCode.trim() : '';
  if (!normalizedCode) {
    const err = { code: 'INVALID_PAYLOAD', message: 'Meeting code is required' };
    socket.emit('meeting:error', err);
    ack?.({ success: false, ...err });
    return;
  }

  const roomState = meetingRooms.get(normalizedCode);
  if (roomState) {
    const hostParticipant = roomState.participants.get(user.id);
    if (roomState.hostUserId !== user.id || !hostParticipant || !hostParticipant.socketIds.has(socket.id)) {
      const err = { code: 'NOT_MEETING_HOST', message: 'Only the host active in this meeting can end it' };
      socket.emit('meeting:error', err);
      ack?.({ success: false, ...err });
      return;
    }
  }

  try {
    await endMeeting(normalizedCode, user.id);
    ack?.({ success: true, message: 'Meeting ended successfully' });
  } catch (err: any) {
    const statusCode = err.statusCode || 500;
    let code = 'SERVER_ERROR';
    if (statusCode === 404) code = 'MEETING_NOT_FOUND';
    else if (statusCode === 403) code = 'NOT_MEETING_HOST';
    else if (statusCode === 400) code = 'MEETING_ALREADY_ENDED';

    const errorPayload = { code, message: err.message || 'Failed to end meeting' };
    socket.emit('meeting:error', errorPayload);
    ack?.({ success: false, ...errorPayload });
  }
};

export const handleDisconnectCleanup = (io: Server, socket: Socket) => {
  const socketMeetings = socketToMeetingsMap.get(socket.id);
  if (socketMeetings) {
    const meetingCodes = Array.from(socketMeetings);
    meetingCodes.forEach((meetingCode) => {
      handleLeaveMeeting(io, socket, meetingCode);
    });
  }
};
