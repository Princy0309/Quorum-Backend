import { Server, Socket } from 'socket.io';
import prisma from '../config/prisma.js';
import { MeetingStatus } from '@prisma/client';
import { getMeeting } from '../services/meetingService.js';

export interface Participant {
  userId: string;
  name: string;
  socketId: string;
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
export const socketToMeetingMap = new Map<string, string>();

export const getOrCreateMeetingState = async (meetingCode: string, userId: string): Promise<MeetingRoomState | null> => {
  let state = meetingRooms.get(meetingCode);
  if (!state) {
    let hostUserId = userId;
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
  const roomState = await getOrCreateMeetingState(normalizedCode, user.id);

  if (!roomState) {
    socket.emit('meeting:error', { message: 'Meeting not found or already ended' });
    return;
  }

  const isHost = roomState.hostUserId === user.id || roomState.participants.size === 0;
  if (isHost && roomState.hostUserId !== user.id) {
    roomState.hostUserId = user.id;
  }

  if (!isHost && roomState.waitingRoomEnabled) {
    const waitingUser: WaitingUser = {
      userId: user.id,
      name: user.name || 'Guest',
      socketId: socket.id,
    };
    roomState.waitingRoom.set(user.id, waitingUser);
    socketToMeetingMap.set(socket.id, normalizedCode);

    socket.emit('meeting:waiting-room', {
      message: 'You are in the waiting room. Please wait for the host to admit you.',
      meetingCode: normalizedCode,
    });

    const hostParticipant = Array.from(roomState.participants.values()).find((p) => p.role === 'host');
    if (hostParticipant) {
      io.to(hostParticipant.socketId).emit('meeting:guest-waiting', { user: waitingUser });
    }
    return;
  }

  const participantRole: 'host' | 'participant' = isHost ? 'host' : 'participant';
  const participant: Participant = {
    userId: user.id,
    name: user.name || 'Participant',
    socketId: socket.id,
    role: participantRole,
    joinedAt: new Date(),
  };

  roomState.participants.set(user.id, participant);
  socketToMeetingMap.set(socket.id, normalizedCode);
  socket.join(normalizedCode);

  const activeParticipants = Array.from(roomState.participants.values());
  const waitingUsersList = Array.from(roomState.waitingRoom.values());

  socket.emit('meeting:joined', {
    meetingCode: normalizedCode,
    role: participantRole,
    participants: activeParticipants,
    waitingRoom: isHost ? waitingUsersList : [],
  });

  socket.to(normalizedCode).emit('meeting:participant-joined', {
    participant,
    participants: activeParticipants,
  });

  io.to(normalizedCode).emit('meeting:presence-update', {
    participants: activeParticipants,
  });
};

export const handleLeaveMeeting = (io: Server, socket: Socket, meetingCode: string) => {
  const user = socket.data.user;
  if (!user || !user.id) return;

  const roomState = meetingRooms.get(meetingCode);
  if (!roomState) return;

  let wasParticipant = false;
  if (roomState.participants.has(user.id)) {
    roomState.participants.delete(user.id);
    wasParticipant = true;
  }
  roomState.waitingRoom.delete(user.id);
  socketToMeetingMap.delete(socket.id);
  socket.leave(meetingCode);

  if (wasParticipant) {
    const activeParticipants = Array.from(roomState.participants.values());
    io.to(meetingCode).emit('meeting:participant-left', {
      userId: user.id,
      socketId: socket.id,
      participants: activeParticipants,
    });
    io.to(meetingCode).emit('meeting:presence-update', {
      participants: activeParticipants,
    });
  }

  if (roomState.participants.size === 0 && roomState.waitingRoom.size === 0) {
    meetingRooms.delete(meetingCode);
  }
};

export const handleDisconnectCleanup = (io: Server, socket: Socket) => {
  const meetingCode = socketToMeetingMap.get(socket.id);
  if (meetingCode) {
    handleLeaveMeeting(io, socket, meetingCode);
  }
};
