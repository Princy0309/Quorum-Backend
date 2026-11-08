import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError.js';
import {
  startMeetingRecording,
  stopMeetingRecording,
  completeMeetingRecording,
  getRecordingUploadUrl,
  getMeetingRecordings,
  getRecordingById,
  deleteRecording,
  summarizeMeetingRecording,
} from '../services/recordingService.js';
import {
  completeRecordingSchema,
  getRecordingsQuerySchema,
  summarizeRecordingSchema,
} from '../validators/recordingValidators.js';

export const startMeetingRecordingController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const meetingCode = Array.isArray(req.params.code) ? req.params.code[0] : (req.params.code || req.body?.meetingCode);
    if (!meetingCode) throw new ApiError(400, 'Meeting code is required');

    const recording = await startMeetingRecording(userId, meetingCode);
    res.status(201).json({
      success: true,
      message: 'Recording started successfully',
      data: recording,
    });
  } catch (err) {
    next(err);
  }
};

export const stopMeetingRecordingController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const meetingCode = Array.isArray(req.params.code) ? req.params.code[0] : (req.params.code || req.body?.meetingCode);
    if (!meetingCode) throw new ApiError(400, 'Meeting code is required');

    const recording = await stopMeetingRecording(userId, meetingCode);
    res.status(200).json({
      success: true,
      message: 'Recording stopped successfully',
      data: recording,
    });
  } catch (err) {
    next(err);
  }
};

export const getRecordingUploadUrlController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const meetingCode = Array.isArray(req.params.code) ? req.params.code[0] : (req.params.code || req.body?.meetingCode);
    if (!meetingCode) throw new ApiError(400, 'Meeting code is required');

    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'recording.mp4';
    const uploadData = await getRecordingUploadUrl(userId, meetingCode, fileName);

    res.status(200).json({
      success: true,
      data: uploadData,
    });
  } catch (err) {
    next(err);
  }
};

export const getMeetingRecordingsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const meetingCode = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
    if (!meetingCode) throw new ApiError(400, 'Meeting code is required');

    const parsedQuery = getRecordingsQuerySchema.parse(req.query);
    const result = await getMeetingRecordings(userId, meetingCode, parsedQuery);

    res.status(200).json({
      success: true,
      data: result.recordings,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getRecordingByIdController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const recordingId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!recordingId) throw new ApiError(400, 'Recording ID is required');

    const recording = await getRecordingById(userId, recordingId);
    res.status(200).json({
      success: true,
      data: recording,
    });
  } catch (err) {
    next(err);
  }
};

export const completeRecordingController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const recordingId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!recordingId) throw new ApiError(400, 'Recording ID is required');

    const parsedBody = completeRecordingSchema.parse(req.body);
    const recording = await completeMeetingRecording(userId, recordingId, parsedBody);

    res.status(200).json({
      success: true,
      message: 'Recording completed successfully',
      data: recording,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteRecordingController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const recordingId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!recordingId) throw new ApiError(400, 'Recording ID is required');

    const result = await deleteRecording(userId, recordingId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const summarizeRecordingController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const recordingId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!recordingId) throw new ApiError(400, 'Recording ID is required');

    const parsedBody = summarizeRecordingSchema.parse(req.body || {});
    const result = await summarizeMeetingRecording(userId, recordingId, parsedBody);

    res.status(200).json({
      success: true,
      message: 'Meeting summary generated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

