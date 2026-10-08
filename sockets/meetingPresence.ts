import { Server, Socket } from 'socket.io';
import prisma from '../config/prisma.js';

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

export const getOrCreateMeetingState = async (meetingCode: string, userId: string): Promise<MeetingRoomState> => {
  let state = meetingRooms.get(meetingCode);
  if (!state) {
    let hostUserId = userId;
    let waitingRoomEnabled = true;

    try {
      const dbMeeting = await prisma.$queryRaw<Array<{ hostId?: string; hostUserId?: string; waitingRoom?: boolean }>>`
        SELECT * FROM "Meeting" WHERE "code" = ${meetingCode} OR "id" = ${meetingCode} LIMIT 1
      `;
      if (dbMeeting && dbMeeting.length > 0) {
        const meeting = dbMeeting[0];
        hostUserId = meeting.hostId || meeting.hostUserId || userId;
        if (typeof meeting.waitingRoom === 'boolean') {
          waitingRoomEnabled = meeting.waitingRoom;
        }
      }
    } catch (e) {
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
    socket.emit('meeting:error', { message: 'Unauthorized' });
    return;
  }

  if (!meetingCode || typeof meetingCode !== 'string' || !meetingCode.trim()) {
    socket.emit('meeting:error', { message: 'Meeting code is required' });
    return;
  }

  const normalizedCode = meetingCode.trim();
  const roomState = await getOrCreateMeetingState(normalizedCode, user.id);

  const isHost = roomState.hostUserId === user.id || roomState.participants.size === 0;
  if (isHost && roomState.hostUserId !== user.id) {
    roomState.hostUserId = user.id;
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

  socket.emit('meeting:joined', {
    meetingCode: normalizedCode,
    role: participantRole,
    participants: activeParticipants,
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
