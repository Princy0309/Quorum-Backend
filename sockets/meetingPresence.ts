import { Server, Socket } from 'socket.io';
import prisma from '../config/prisma.js';
import { MeetingStatus } from '@prisma/client';
import { getMeeting } from '../services/meetingService.js';

export interface Participant {
  userId: string;
  name: string;
  socketIds: Set<string>;
  role: 'host' | 'participant';
  joinedAt: Date;
}

export interface ParticipantDTO {
  userId: string;
  name: string;
  role: 'host' | 'participant';
  joinedAt: Date;
}

export interface WaitingUser {
  userId: string;
  name: string;
  socketId: string;
}

export interface MeetingRoomState {
  code: string;
  hostUserId: string;
  waitingRoomEnabled: boolean;
  participants: Map<string, Participant>;
  waitingRoom: Map<string, WaitingUser>;
}

export const meetingRooms = new Map<string, MeetingRoomState>();
export const socketToMeetingMap = new Map<string, { meetingCode: string; userId: string }>();

export const formatParticipants = (participantsMap: Map<string, Participant>): ParticipantDTO[] => {
  return Array.from(participantsMap.values()).map((p) => ({
    userId: p.userId,
    name: p.name,
    role: p.role,
    joinedAt: p.joinedAt,
  }));
};

export const getOrCreateMeetingState = async (meetingCode: string): Promise<MeetingRoomState | null> => {
  let state = meetingRooms.get(meetingCode);
  if (!state) {
    let hostUserId: string | null = null;
    let waitingRoomEnabled = true;

    try {
      const meeting = await getMeeting(meetingCode);
      if (meeting) {
        hostUserId = meeting.hostId;
        waitingRoomEnabled = meeting.waitingRoom;
      }
    } catch (err) {
      try {
        const dbMeeting = await prisma.meeting.findFirst({
          where: {
            code: meetingCode,
            status: MeetingStatus.ACTIVE,
          },
        });
        if (dbMeeting) {
          hostUserId = dbMeeting.hostId;
          waitingRoomEnabled = dbMeeting.waitingRoom;
        } else {
          return null;
        }
      } catch (e) {
        return null;
      }
    }

    if (!hostUserId) {
      return null;
    }

    state = {
      code: meetingCode,
      hostUserId,
      waitingRoomEnabled,
      participants: new Map(),
      waitingRoom: new Map(),
    };
    meetingRooms.set(meetingCode, state);
  }
  return state;
};

export const handleJoinMeeting = async (io: Server, socket: Socket, meetingCode: string) => {
  const user = socket.data.user;
  if (!user || !user.id) {
    socket.emit('meeting:error', { message: 'Unauthorized: Authentication required' });
    return;
  }

  if (!meetingCode || typeof meetingCode !== 'string' || !meetingCode.trim()) {
    socket.emit('meeting:error', { message: 'Meeting code is required' });
    return;
  }

  const normalizedCode = meetingCode.trim();
  const roomState = await getOrCreateMeetingState(normalizedCode);

  if (!roomState) {
    socket.emit('meeting:error', { message: 'Meeting not found or already ended' });
    return;
  }

  const isHost = roomState.hostUserId === user.id;

  if (!isHost && roomState.waitingRoomEnabled && !roomState.participants.has(user.id)) {
    const waitingUser: WaitingUser = {
      userId: user.id,
      name: user.name || 'Guest',
      socketId: socket.id,
    };
    roomState.waitingRoom.set(user.id, waitingUser);
    socketToMeetingMap.set(socket.id, { meetingCode: normalizedCode, userId: user.id });

    socket.emit('meeting:waiting-room', {
      message: 'You are in the waiting room. Please wait for the host to admit you.',
      meetingCode: normalizedCode,
    });

    const hostParticipant = Array.from(roomState.participants.values()).find((p) => p.role === 'host');
    if (hostParticipant) {
      hostParticipant.socketIds.forEach((hostSocketId) => {
        io.to(hostSocketId).emit('meeting:guest-waiting', { user: waitingUser });
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
    });
  }

  socketToMeetingMap.set(socket.id, { meetingCode: normalizedCode, userId: user.id });
  socket.join(normalizedCode);

  const activeParticipants = formatParticipants(roomState.participants);
  const waitingUsersList = Array.from(roomState.waitingRoom.values());
  const currentParticipant = roomState.participants.get(user.id)!;

  const participantSummary: ParticipantDTO = {
    userId: currentParticipant.userId,
    name: currentParticipant.name,
    role: currentParticipant.role,
    joinedAt: currentParticipant.joinedAt,
  };

  socket.emit('meeting:joined', {
    meetingCode: normalizedCode,
    role: participantRole,
    participants: activeParticipants,
    waitingRoom: isHost ? waitingUsersList : [],
  });

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

export const handleLeaveMeeting = (io: Server, socket: Socket, meetingCode: string) => {
  const user = socket.data.user;
  if (!user || !user.id) return;

  const roomState = meetingRooms.get(meetingCode);
  if (!roomState) return;

  socketToMeetingMap.delete(socket.id);
  socket.leave(meetingCode);

  const participant = roomState.participants.get(user.id);
  if (participant) {
    participant.socketIds.delete(socket.id);

    if (participant.socketIds.size === 0) {
      roomState.participants.delete(user.id);

      const activeParticipants = formatParticipants(roomState.participants);
      io.to(meetingCode).emit('meeting:participant-left', {
        userId: user.id,
        socketId: socket.id,
        participants: activeParticipants,
      });
      io.to(meetingCode).emit('meeting:presence-update', {
        participants: activeParticipants,
      });
    }
  }

  const waitingUser = roomState.waitingRoom.get(user.id);
  if (waitingUser && waitingUser.socketId === socket.id) {
    roomState.waitingRoom.delete(user.id);
  }

  if (roomState.participants.size === 0 && roomState.waitingRoom.size === 0) {
    meetingRooms.delete(meetingCode);
  }
};

export const handleDisconnectCleanup = (io: Server, socket: Socket) => {
  const mapping = socketToMeetingMap.get(socket.id);
  if (mapping) {
    handleLeaveMeeting(io, socket, mapping.meetingCode);
  }
};
