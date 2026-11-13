import { Server, Socket } from 'socket.io';
import { SocketAckResponse, normalizeMeetingCode, meetingRooms } from './meetingPresence.js';
import prisma from '../config/prisma.js';
import { RecordingStatus } from '@prisma/client';
import {
  startMeetingRecording,
  stopMeetingRecording,
  canUserAccessMeetingRecordings,
} from '../services/recordingService.js';
import logger from '../utils/logger.js';

export const handleStartRecording = async (
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
    const recording = await startMeetingRecording(user.id, normalizedCode);
    ack?.({ success: true, data: recording });
  } catch (err: any) {
    logger.error('Error starting recording via socket', { error: err.message, meetingCode: normalizedCode });
    const responseErr = {
      code: err.code || 'RECORDING_START_FAILED',
      message: err.message || 'Failed to start meeting recording',
    };
    socket.emit('meeting:error', responseErr);
    ack?.({ success: false, ...responseErr });
  }
};

export const handleStopRecording = async (
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
    const recording = await stopMeetingRecording(user.id, normalizedCode);
    ack?.({ success: true, data: recording });
  } catch (err: any) {
    logger.error('Error stopping recording via socket', { error: err.message, meetingCode: normalizedCode });
    const responseErr = {
      code: err.code || 'RECORDING_STOP_FAILED',
      message: err.message || 'Failed to stop meeting recording',
    };
    socket.emit('meeting:error', responseErr);
    ack?.({ success: false, ...responseErr });
  }
};

export const handleGetRecordingStatus = async (
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
    const hasAccess = await canUserAccessMeetingRecordings(user.id, normalizedCode);
    if (!hasAccess) {
      const err = {
        code: 'FORBIDDEN',
        message: 'You do not have permission to view recording status for this meeting',
      };
      socket.emit('meeting:error', err);
      ack?.({ success: false, ...err });
      return;
    }

    const activeRecording = await prisma.meetingRecording.findFirst({
      where: {
        meetingCode: normalizedCode,
        status: { in: [RecordingStatus.RECORDING, RecordingStatus.PROCESSING] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        recordedBy: { select: { id: true, name: true, avatar: true } },
      },
    });

    const isRecording = activeRecording?.status === RecordingStatus.RECORDING;
    const roomState = meetingRooms.get(normalizedCode);
    if (roomState) {
      (roomState as any).isRecording = isRecording;
      (roomState as any).recordingId = activeRecording?.id || undefined;
      (roomState as any).recordingStartedAt = activeRecording?.startedAt || undefined;
      (roomState as any).recordingStartedBy = activeRecording?.recordedBy || undefined;
    }

    const data = {
      isRecording,
      status: activeRecording?.status || null,
      recordingId: activeRecording?.id || null,
      startedAt: activeRecording?.startedAt || null,
      startedBy: activeRecording?.recordedBy || null,
    };

    socket.emit('meeting:recording-status', data);
    ack?.({ success: true, data });
  } catch (err: any) {
    logger.error('Error fetching recording status via socket', { error: err?.message, meetingCode: normalizedCode });
    const responseErr = {
      code: err?.code || 'RECORDING_STATUS_FAILED',
      message: err?.message || 'Failed to retrieve meeting recording status',
    };
    socket.emit('meeting:error', responseErr);
    ack?.({ success: false, ...responseErr });
  }
};
