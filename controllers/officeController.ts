import { Request, Response } from 'express';
import { z } from 'zod';
import logger from '../utils/logger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { getIO } from '../sockets/socketServer.js';
import { OFFICE_EVENTS } from '../utils/constants.js';
import {
  getOfficeFloorState,
  knockOnDesk,
  changeOfficeZone,
  leaveOffice,
  joinOffice,
  startWarRoomMeeting,
  endWarRoomMeeting,
} from '../services/officeService.js';
import { OfficeZoneId } from '../types/office.js';
import { getUserPresence } from '../services/presenceService.js';
import { broadcastUserPresenceUpdate } from '../sockets/handlers/presenceHandler.js';

const knockSchema = z.object({
  targetUserId: z.string().min(1, 'targetUserId is required'),
  message: z.string().max(100, 'Message cannot exceed 100 characters').optional(),
});

const changeZoneSchema = z.object({
  zoneId: z.enum(['WAR_ROOM', 'OPEN_WORKSPACE', 'COFFEE_LOUNGE', 'FOCUS_POD']),
  deskId: z.string().optional().nullable(),
  durationMinutes : z.number().int().min(5).max(480).optional().nullable(),
});

const startMeetingSchema = z.object({
  meetingCode: z.string().min(1, 'meetingCode is required'),
});

const claimDeskSchema = z.object({
  deskId: z.string().min(1, 'deskId is required (e.g. "desk_1")'),
});

export const getOfficeFloorController = asyncHandler(async (req: Request, res: Response) => {
  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  const floorState = await getOfficeFloorState(teamId);
  return sendSuccess(res, 200, 'Virtual office floor state retrieved successfully', floorState);
});

export const joinOfficeController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  const result = await joinOffice(teamId, {
    id: userId,
    name: req.user?.name || 'Teammate',
    avatarUrl: req.user?.avatar || null,
  });

  try {
    const io = getIO();
    io.to(`office:team:${teamId}`).emit(OFFICE_EVENTS.USER_JOINED, {
      teamId,
      member: result.member,
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn(`[OfficeController] Optional socket broadcast failed: ${errorMessage}`);
  }

  return sendSuccess(res, 200, 'Joined virtual office floor', result);
});

export const knockOnDeskController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  const parsed = knockSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    throw new ApiError(400, errorMsg);
  }

  const knockedEvent = await knockOnDesk(
    {
      teamId,
      targetUserId: parsed.data.targetUserId,
      message: parsed.data.message,
    },
    {
      id: userId,
      name: req.user?.name || 'Teammate',
      avatarUrl: req.user?.avatar || null,
    }
  );

  try {
    const io = getIO();
    io.to(`user:${parsed.data.targetUserId}`).emit(OFFICE_EVENTS.KNOCKED, knockedEvent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[OfficeController] Failed to emit knock socket event: ${message}`);
  }

  return sendSuccess(res, 200, 'Knocked on desk successfully', knockedEvent);
});

export const claimDeskController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  const parsed = claimDeskSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    throw new ApiError(400, errorMsg);
  }

  const changeEvent = await changeOfficeZone(
    teamId,
    userId,
    'OPEN_WORKSPACE',
    parsed.data.deskId
  );

  try {
    const io = getIO();
    io.to(`office:team:${teamId}`).emit(OFFICE_EVENTS.ZONE_CHANGED, changeEvent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[OfficeController] Failed to broadcast desk change socket event: ${message}`);
  }

  return sendSuccess(res, 200, 'Desk claimed successfully', changeEvent);
});

export const changeOfficeZoneController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  const parsed = changeZoneSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    throw new ApiError(400, errorMsg);
  }

  const changeEvent = await changeOfficeZone(
    teamId,
    userId,
    parsed.data.zoneId as OfficeZoneId,
    parsed.data.deskId,
    parsed.data.durationMinutes
  );

  try {
    const io = getIO();
    io.to(`office:team:${teamId}`).emit(OFFICE_EVENTS.ZONE_CHANGED, changeEvent);

    const presence = await getUserPresence(userId);
    await broadcastUserPresenceUpdate(io, userId, presence);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[OfficeController] Failed to broadcast zone change socket event: ${message}`);
  }

  return sendSuccess(res, 200, 'Office zone changed successfully', changeEvent);
});

export const leaveOfficeController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  await leaveOffice(teamId, userId);

  try {
    const io = getIO();
    io.to(`office:team:${teamId}`).emit(OFFICE_EVENTS.USER_LEFT, {
      teamId,
      userId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[OfficeController] Failed to broadcast user left socket event: ${message}`);
  }

  return sendSuccess(res, 200, 'Left virtual office floor successfully');
});

export const startWarRoomMeetingController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  const parsed = startMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    throw new ApiError(400, errorMsg);
  }

  const result = await startWarRoomMeeting(teamId, parsed.data.meetingCode, {
    id: userId,
    name: req.user?.name || 'Teammate',
  });

  // Broadcast to the whole team floor that the War Room meeting is live!
  try {
    const io = getIO();
    io.to(`office:team:${teamId}`).emit(OFFICE_EVENTS.MEETING_STARTED, result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[OfficeController] Failed to broadcast meeting started: ${message}`);
  }

  return sendSuccess(res, 200, 'War Room meeting started successfully', result);
});

export const endWarRoomMeetingController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  const result = await endWarRoomMeeting(teamId, userId);

  // Broadcast that the War Room meeting has concluded
  try {
    const io = getIO();
    io.to(`office:team:${teamId}`).emit(OFFICE_EVENTS.MEETING_ENDED, result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[OfficeController] Failed to broadcast meeting ended: ${message}`);
  }

  return sendSuccess(res, 200, 'War Room meeting ended successfully', result);
});
