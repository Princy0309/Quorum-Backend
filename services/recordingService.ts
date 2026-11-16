import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { RecordingStatus, MeetingStatus, MeetingScopeType } from '@prisma/client';
import { getIO } from '../sockets/socketServer.js';
import { meetingRooms, normalizeMeetingCode } from '../sockets/meetingPresence.js';
import { canUserJoinMeeting } from './meetingPermissionService.js';
import {
  deleteS3Object,
  generateS3PresignedUpload,
  getS3SignedDownloadUrl,
  getS3ObjectText,
  verifyS3ObjectExists,
  isS3Configured
} from '../config/s3.js';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { generateRawCompletion } from './aiService.js';
import { CompleteRecordingInput, SummarizeRecordingInput, StopRecordingInput } from '../validators/recordingValidators.js';
import { CHAT_EVENTS } from '../utils/constants.js';
import { sendPushToOfflineUsers } from './notificationService.js';

let schemaInitialized = false;

export const ensureRecordingSchema = async () => {
  if (schemaInitialized) return;
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingStatus') THEN
              CREATE TYPE "RecordingStatus" AS ENUM ('RECORDING', 'PROCESSING', 'COMPLETED', 'FAILED');
          END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MeetingRecording" (
          "id" TEXT NOT NULL,
          "meetingId" TEXT,
          "meetingCode" TEXT NOT NULL,
          "recordedById" TEXT,
          "status" "RecordingStatus" NOT NULL DEFAULT 'RECORDING',
          "fileUrl" TEXT,
          "thumbnailUrl" TEXT,
          "transcriptUrl" TEXT,
          "summary" TEXT,
          "durationSeconds" INTEGER,
          "fileSizeBytes" BIGINT,
          "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "endedAt" TIMESTAMP(3),
          "expiresAt" TIMESTAMP(3),
          "errorMessage" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`ALTER TABLE "MeetingRecording" ALTER COLUMN "meetingId" DROP NOT NULL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "MeetingRecording" ALTER COLUMN "recordedById" DROP NOT NULL;`);

    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MeetingRecording_meetingId_idx" ON "MeetingRecording"("meetingId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MeetingRecording_meetingCode_idx" ON "MeetingRecording"("meetingCode");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MeetingRecording_recordedById_idx" ON "MeetingRecording"("recordedById");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MeetingRecording_expiresAt_idx" ON "MeetingRecording"("expiresAt");`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MeetingRecording_single_active_idx" ON "MeetingRecording"("meetingCode") WHERE status = 'RECORDING';`);

    await prisma.$executeRawUnsafe(`ALTER TABLE "MeetingRecording" DROP CONSTRAINT IF EXISTS "MeetingRecording_meetingId_fkey";`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_meetingId_fkey"
          FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await prisma.$executeRawUnsafe(`ALTER TABLE "MeetingRecording" DROP CONSTRAINT IF EXISTS "MeetingRecording_recordedById_fkey";`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_recordedById_fkey"
          FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    schemaInitialized = true;
  } catch (err) {
    logger.error('Failed to self-heal recording schema:', err);
    throw err;
  }
};

export const serializeRecording = (recording: any) => {
  if (!recording) return null;
  return {
    ...recording,
    fileSizeBytes: recording.fileSizeBytes !== null && recording.fileSizeBytes !== undefined
      ? Number(recording.fileSizeBytes)
      : null,
  };
};

export const canUserAccessMeetingRecordings = async (
  userId: string,
  meetingCode: string,
  recording?: { recordedById?: string | null; meetingId?: string | null }
): Promise<boolean> => {
  if (recording && recording.recordedById === userId) {
    return true;
  }

  const meeting = await prisma.meeting.findUnique({
    where: { code: meetingCode },
    select: {
      id: true,
      hostId: true,
      scopeType: true,
      organizationId: true,
      teamId: true,
      admitted: true,
    },
  });

  if (!meeting) {
    return recording ? recording.recordedById === userId : false;
  }

  if (meeting.hostId === userId) {
    return true;
  }

  if (Array.isArray(meeting.admitted) && meeting.admitted.includes(userId)) {
    return true;
  }

  if (meeting.scopeType === MeetingScopeType.ORGANIZATION && meeting.organizationId) {
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: meeting.organizationId,
          userId,
        },
      },
    });
    if (orgMember) return true;
  }

  if (meeting.scopeType === MeetingScopeType.TEAM && meeting.teamId) {
    const teamMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: meeting.teamId,
          userId,
        },
      },
    });
    if (teamMember) return true;
  }

  return false;
};

export const startMeetingRecording = async (userId: string, rawMeetingCode: string) => {
  await ensureRecordingSchema();
  const meetingCode = normalizeMeetingCode(rawMeetingCode);

  const recording = await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.findFirst({
      where: { code: meetingCode },
      include: {
        host: { select: { id: true, name: true, avatar: true } }
      }
    });

    if (!meeting) {
      throw new ApiError(404, 'Meeting not found');
    }

    if (meeting.status === MeetingStatus.ENDED || meeting.status === MeetingStatus.CANCELLED) {
      throw new ApiError(400, 'Cannot record a meeting that has ended or been cancelled');
    }

    if (meeting.hostId !== userId) {
      throw new ApiError(403, 'Only the meeting host can start recording');
    }

    await tx.$queryRawUnsafe(`SELECT id FROM "Meeting" WHERE id = $1 FOR UPDATE`, meeting.id);

    const lockedMeeting = await tx.meeting.findUnique({
      where: { id: meeting.id },
      select: { id: true, status: true }
    });

    if (!lockedMeeting || lockedMeeting.status === MeetingStatus.ENDED || lockedMeeting.status === MeetingStatus.CANCELLED) {
      throw new ApiError(400, 'Cannot record a meeting that has ended or been cancelled');
    }

    const existingActive = await tx.meetingRecording.findFirst({
      where: {
        meetingCode,
        status: RecordingStatus.RECORDING,
      },
      include: {
        recordedBy: { select: { id: true, name: true, avatar: true } }
      }
    });

    if (existingActive) {
      return existingActive;
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return await tx.meetingRecording.create({
      data: {
        meetingId: meeting.id,
        meetingCode,
        recordedById: userId,
        status: RecordingStatus.RECORDING,
        startedAt: new Date(),
        expiresAt,
      },
      include: {
        recordedBy: { select: { id: true, name: true, avatar: true } }
      }
    });
  });

  const roomState = meetingRooms.get(meetingCode);
  if (roomState) {
    (roomState as any).isRecording = true;
    (roomState as any).recordingId = recording.id;
    (roomState as any).recordingStartedAt = recording.startedAt;
    (roomState as any).recordingStartedBy = recording.recordedBy;
  }

  try {
    getIO().to(meetingCode).emit('meeting:recording-status', {
      isRecording: true,
      status: RecordingStatus.RECORDING,
      recordingId: recording.id,
      meetingCode,
      startedBy: {
        id: recording.recordedBy?.id || userId,
        name: recording.recordedBy?.name || 'Host',
        avatar: recording.recordedBy?.avatar || null,
      },
      startedAt: recording.startedAt,
    });
  } catch (emitErr) {
    logger.warn('Socket broadcast for recording-status failed:', emitErr);
  }

  return serializeRecording(recording);
};

export const stopMeetingRecording = async (
  userId: string,
  rawMeetingCode: string,
  extraData?: Partial<StopRecordingInput>
) => {
  await ensureRecordingSchema();
  const meetingCode = normalizeMeetingCode(rawMeetingCode);

  const { updatedRecording, duration, now } = await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.findFirst({
      where: { code: meetingCode },
    });

    if (!meeting) {
      throw new ApiError(404, 'Meeting not found');
    }

    if (extraData?.teamId && !meeting.teamId) {
      await tx.meeting.update({
        where: { id: meeting.id },
        data: { teamId: extraData.teamId, scopeType: MeetingScopeType.TEAM },
      });
      meeting.teamId = extraData.teamId;
    }

    const activeRecording = await tx.meetingRecording.findFirst({
      where: {
        meetingCode,
        status: RecordingStatus.RECORDING,
      },
      include: {
        recordedBy: { select: { id: true, name: true, avatar: true } }
      }
    });

    if (!activeRecording) {
      throw new ApiError(404, 'No active recording found for this meeting');
    }

    if (meeting.hostId !== userId && activeRecording.recordedById !== userId) {
      throw new ApiError(403, 'Only the host or the recording initiator can stop this recording');
    }

    await tx.$queryRawUnsafe(`SELECT id FROM "MeetingRecording" WHERE id = $1 FOR UPDATE`, activeRecording.id);

    const lockedRecording = await tx.meetingRecording.findUnique({
      where: { id: activeRecording.id },
      include: {
        recordedBy: { select: { id: true, name: true, avatar: true } }
      }
    });

    if (!lockedRecording || lockedRecording.status !== RecordingStatus.RECORDING) {
      throw new ApiError(404, 'No active recording found for this meeting');
    }

    const now = new Date();
    const duration = extraData?.durationSeconds !== undefined
      ? extraData.durationSeconds
      : Math.max(1, Math.floor((now.getTime() - lockedRecording.startedAt.getTime()) / 1000));
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const hasFileUrl = typeof extraData?.fileUrl === 'string' && extraData.fileUrl.trim().length > 0;
    const finalFileSize = extraData?.fileSizeBytes !== undefined ? BigInt(extraData.fileSizeBytes) : undefined;

    const updated = await tx.meetingRecording.update({
      where: { id: lockedRecording.id },
      data: {
        status: hasFileUrl ? RecordingStatus.COMPLETED : RecordingStatus.PROCESSING,
        endedAt: now,
        durationSeconds: duration,
        expiresAt,
        ...(hasFileUrl ? { fileUrl: extraData!.fileUrl } : {}),
        ...(extraData?.thumbnailUrl ? { thumbnailUrl: extraData.thumbnailUrl } : {}),
        ...(extraData?.transcriptUrl ? { transcriptUrl: extraData.transcriptUrl } : {}),
        ...(extraData?.summary ? { summary: extraData.summary } : {}),
        ...(finalFileSize !== undefined ? { fileSizeBytes: finalFileSize } : {}),
      },
      include: {
        recordedBy: { select: { id: true, name: true, avatar: true } }
      }
    });

    return { updatedRecording: updated, duration, now };
  });

  const roomState = meetingRooms.get(meetingCode);
  if (roomState) {
    (roomState as any).isRecording = false;
    (roomState as any).recordingId = undefined;
    (roomState as any).recordingStartedAt = undefined;
    (roomState as any).recordingStartedBy = undefined;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, avatar: true }
  });

  try {
    getIO().to(meetingCode).emit('meeting:recording-status', {
      isRecording: false,
      status: updatedRecording.status,
      recordingId: updatedRecording.id,
      meetingCode,
      durationSeconds: duration,
      stoppedBy: {
        id: user?.id || userId,
        name: user?.name || 'User',
      },
      endedAt: now,
    });
  } catch (emitErr) {
    logger.warn('Socket broadcast for recording-status stop failed:', emitErr);
  }

  try {
    await postRecordingToTeamChat(updatedRecording.id);
  } catch (chatErr) {
    logger.warn('Failed to post recording to team chat on stop:', chatErr);
  }

  return serializeRecording(updatedRecording);
};

export const completeMeetingRecording = async (
  userId: string,
  recordingId: string,
  data: CompleteRecordingInput
) => {
  await ensureRecordingSchema();

  const recording = await prisma.meetingRecording.findUnique({
    where: { id: recordingId },
    include: {
      meeting: true
    }
  });

  if (!recording) {
    throw new ApiError(404, 'Recording not found');
  }

  const isHost = recording.meeting?.hostId === userId;
  const isCreator = recording.recordedById === userId;
  if (!isHost && !isCreator) {
    throw new ApiError(403, 'Not authorized to complete this recording');
  }

  if (recording.status !== RecordingStatus.PROCESSING) {
    throw new ApiError(400, `Recording must be stopped before it can be completed (current status: ${recording.status})`);
  }

  if (!isS3Configured()) {
    throw new ApiError(500, 'Cloud storage must be configured to verify and complete meeting recordings');
  }

  const s3Verification = await verifyS3ObjectExists(data.fileUrl);
  if (!s3Verification.exists || !s3Verification.isValidStorageHost) {
    throw new ApiError(400, 'Recording file not found in configured storage. Ensure the file has been uploaded before completing.');
  }

  const expectedPrefix = `recordings/${recording.meetingCode}/`;
  if (!s3Verification.key.startsWith(expectedPrefix)) {
    throw new ApiError(400, 'Uploaded file does not belong to this meeting recording');
  }

  if (data.thumbnailUrl) {
    const thumbVerification = await verifyS3ObjectExists(data.thumbnailUrl);
    if (!thumbVerification.exists || !thumbVerification.isValidStorageHost) {
      throw new ApiError(400, 'Recording thumbnail not found in configured storage');
    }
    if (!thumbVerification.key.startsWith(expectedPrefix)) {
      throw new ApiError(400, 'Uploaded thumbnail does not belong to this meeting recording');
    }
  }

  if (data.transcriptUrl) {
    const transcriptVerification = await verifyS3ObjectExists(data.transcriptUrl);
    if (!transcriptVerification.exists || !transcriptVerification.isValidStorageHost) {
      throw new ApiError(400, 'Recording transcript not found in configured storage');
    }
    if (!transcriptVerification.key.startsWith(expectedPrefix)) {
      throw new ApiError(400, 'Uploaded transcript does not belong to this meeting recording');
    }
  }

  const verifiedSize = s3Verification.contentLength !== undefined
    ? s3Verification.contentLength
    : data.fileSizeBytes;

  const completedAt = new Date();
  const expiresAt = new Date(completedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  if (data.teamId && recording.meeting && !recording.meeting.teamId) {
    await prisma.meeting.update({
      where: { id: recording.meeting.id },
      data: { teamId: data.teamId, scopeType: MeetingScopeType.TEAM },
    });
  }

  const updated = await prisma.meetingRecording.update({
    where: { id: recordingId },
    data: {
      status: RecordingStatus.COMPLETED,
      fileUrl: data.fileUrl,
      thumbnailUrl: data.thumbnailUrl,
      transcriptUrl: data.transcriptUrl,
      summary: data.summary,
      durationSeconds: data.durationSeconds !== undefined ? data.durationSeconds : recording.durationSeconds,
      fileSizeBytes: verifiedSize !== undefined ? BigInt(verifiedSize) : recording.fileSizeBytes,
      expiresAt,
    },
    include: {
      recordedBy: { select: { id: true, name: true, avatar: true } }
    }
  });

  try {
    await postRecordingToTeamChat(updated.id);
  } catch (chatErr) {
    logger.warn('Failed to post recording to team chat on complete:', chatErr);
  }

  return serializeRecording(updated);
};

export const getRecordingUploadUrl = async (userId: string, rawMeetingCode: string, fileName: string = 'recording.mp4') => {
  await ensureRecordingSchema();
  const meetingCode = normalizeMeetingCode(rawMeetingCode);

  const meeting = await prisma.meeting.findFirst({
    where: { code: meetingCode },
  });

  if (!meeting) {
    throw new ApiError(404, 'Meeting not found');
  }

  if (meeting.status === MeetingStatus.ENDED || meeting.status === MeetingStatus.CANCELLED) {
    throw new ApiError(400, 'Cannot request upload credentials for a meeting that has ended or been cancelled');
  }

  if (meeting.hostId !== userId) {
    throw new ApiError(403, 'Only the host can request upload credentials for this meeting');
  }

  const activeRecording = await prisma.meetingRecording.findFirst({
    where: {
      meetingCode,
      status: { in: [RecordingStatus.RECORDING, RecordingStatus.PROCESSING] },
    },
  });

  if (!activeRecording) {
    throw new ApiError(400, 'No active recording session found for this meeting');
  }

  const sanitizedFileName = (fileName || 'recording.mp4').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  const s3Key = `recordings/${meetingCode}/${Date.now()}_${sanitizedFileName}`;
  const presigned = await generateS3PresignedUpload(s3Key, 'video/mp4', 3600);

  return {
    uploadUrl: presigned.uploadUrl,
    fileUrl: presigned.fileUrl,
    key: presigned.key,
    bucket: presigned.bucket,
    expiresIn: presigned.expiresIn,
  };
};

export const getMeetingRecordings = async (
  userId: string,
  rawMeetingCode: string,
  query: { page?: number; limit?: number }
) => {
  await ensureRecordingSchema();
  const meetingCode = normalizeMeetingCode(rawMeetingCode);

  const allowed = await canUserAccessMeetingRecordings(userId, meetingCode);
  if (!allowed) {
    throw new ApiError(403, 'Not authorized to view recordings for this meeting');
  }

  const page = query.page && query.page > 0 ? query.page : 1;
  const limit = query.limit && query.limit > 0 ? query.limit : 20;
  const skip = (page - 1) * limit;

  const [recordings, total] = await Promise.all([
    prisma.meetingRecording.findMany({
      where: { meetingCode },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        recordedBy: { select: { id: true, name: true, avatar: true } },
      },
    }),
    prisma.meetingRecording.count({
      where: { meetingCode },
    }),
  ]);

  return {
    recordings: recordings.map(serializeRecording),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getRecordingById = async (userId: string, recordingId: string) => {
  await ensureRecordingSchema();

  const recording = await prisma.meetingRecording.findUnique({
    where: { id: recordingId },
    include: {
      meeting: { select: { id: true, code: true, title: true, hostId: true } },
      recordedBy: { select: { id: true, name: true, avatar: true } },
    },
  });

  if (!recording) {
    throw new ApiError(404, 'Recording not found');
  }

  const allowed = await canUserAccessMeetingRecordings(userId, recording.meetingCode, recording);
  if (!allowed) {
    throw new ApiError(403, 'Not authorized to view this recording');
  }

  let signedPlaybackUrl: string | null = null;
  if (recording.fileUrl) {
    signedPlaybackUrl = await getS3SignedDownloadUrl(recording.fileUrl, 3600);
  }

  return {
    ...serializeRecording(recording),
    playbackUrl: signedPlaybackUrl || recording.fileUrl,
  };
};

export const summarizeMeetingRecording = async (
  userId: string,
  recordingId: string,
  options?: SummarizeRecordingInput
) => {
  await ensureRecordingSchema();

  const recording = await prisma.meetingRecording.findUnique({
    where: { id: recordingId },
    include: {
      meeting: { select: { id: true, hostId: true, title: true } }
    }
  });

  if (!recording) {
    throw new ApiError(404, 'Recording not found');
  }

  const allowed = await canUserAccessMeetingRecordings(userId, recording.meetingCode, recording);
  if (!allowed) {
    throw new ApiError(403, 'Not authorized to view or summarize this recording');
  }

  if (recording.summary && !options?.regenerate && !options?.transcriptText) {
    return {
      recordingId: recording.id,
      meetingCode: recording.meetingCode,
      summary: recording.summary,
      isCached: true,
    };
  }

  let transcript = (options?.transcriptText || '').trim();

  if (!transcript && recording.transcriptUrl) {
    try {
      const s3Text = await getS3ObjectText(recording.transcriptUrl);
      if (s3Text) {
        transcript = s3Text.trim();
      } else {
        const signedUrl = await getS3SignedDownloadUrl(recording.transcriptUrl, 300);
        const res = await fetch(signedUrl);
        if (res.ok) {
          transcript = (await res.text()).trim();
        }
      }
    } catch (fetchErr) {
      logger.warn('Failed to fetch transcript from URL:', fetchErr);
    }
  }

  if (!transcript) {
    throw new ApiError(400, 'Transcript text or a valid transcriptUrl is required to generate an AI summary');
  }

  const systemInstruction = 'You are an executive meeting assistant for Quorum. Analyze the provided meeting transcript and produce a well-structured summary in clean Markdown format. Include: 1. Executive Summary, 2. Key Discussion Topics, 3. Decisions Reached, and 4. Action Items (specifying assignees and deadlines if mentioned).';

  const prompt = `Meeting Code: ${recording.meetingCode}\nMeeting Title: ${recording.meeting?.title || 'Untitled'}\nDuration: ${recording.durationSeconds ? Math.floor(recording.durationSeconds / 60) + ' minutes' : 'N/A'}\n\nMeeting Transcript:\n${transcript.slice(0, 50000)}`;

  const aiResult = await generateRawCompletion(prompt, systemInstruction);
  const summary = aiResult.text.trim();

  const updated = await prisma.meetingRecording.update({
    where: { id: recording.id },
    data: { summary },
    include: {
      recordedBy: { select: { id: true, name: true, avatar: true } }
    }
  });

  try {
    await postRecordingToTeamChat(updated.id);
  } catch (chatErr) {
    logger.warn('Failed to post recording to team chat on summarize:', chatErr);
  }

  return {
    recordingId: updated.id,
    meetingCode: updated.meetingCode,
    summary: updated.summary,
    isCached: false,
  };
};

export const deleteRecording = async (userId: string, recordingId: string) => {
  await ensureRecordingSchema();

  const recording = await prisma.meetingRecording.findUnique({
    where: { id: recordingId },
    include: {
      meeting: { select: { hostId: true } }
    }
  });

  if (!recording) {
    throw new ApiError(404, 'Recording not found');
  }

  if (recording.recordedById !== userId && recording.meeting?.hostId !== userId) {
    throw new ApiError(403, 'Only the host or creator can delete this recording');
  }

  if (recording.fileUrl || recording.thumbnailUrl || recording.transcriptUrl) {
    if (!isS3Configured()) {
      throw new ApiError(503, 'Cloud storage is currently unavailable; cannot safely delete recording files');
    }
    if (recording.fileUrl) {
      const deleted = await deleteS3Object(recording.fileUrl);
      if (!deleted) {
        throw new ApiError(500, 'Failed to delete recording video file from cloud storage');
      }
    }
    if (recording.thumbnailUrl) {
      const deletedThumb = await deleteS3Object(recording.thumbnailUrl);
      if (!deletedThumb) {
        throw new ApiError(500, 'Failed to delete recording thumbnail file from cloud storage');
      }
    }
    if (recording.transcriptUrl) {
      const deletedTranscript = await deleteS3Object(recording.transcriptUrl);
      if (!deletedTranscript) {
        throw new ApiError(500, 'Failed to delete recording transcript file from cloud storage');
      }
    }
  }

  await prisma.meetingRecording.delete({
    where: { id: recordingId },
  });

  await prisma.message.deleteMany({
    where: { clientMessageId: `recording_${recordingId}` },
  }).catch(() => {});

  return { success: true, message: 'Recording deleted successfully' };
};

export const stopActiveRecordingForMeeting = async (rawMeetingCode: string) => {
  await ensureRecordingSchema();
  const meetingCode = normalizeMeetingCode(rawMeetingCode);

  const activeRecording = await prisma.meetingRecording.findFirst({
    where: {
      meetingCode,
      status: RecordingStatus.RECORDING,
    },
  });

  if (!activeRecording) return null;

  const now = new Date();
  const duration = Math.max(1, Math.floor((now.getTime() - activeRecording.startedAt.getTime()) / 1000));
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const updated = await prisma.meetingRecording.update({
    where: { id: activeRecording.id },
    data: {
      status: RecordingStatus.PROCESSING,
      endedAt: now,
      durationSeconds: duration,
      expiresAt,
    },
  });

  try {
    getIO().to(meetingCode).emit('meeting:recording-status', {
      isRecording: false,
      status: RecordingStatus.PROCESSING,
      recordingId: updated.id,
      meetingCode,
      durationSeconds: duration,
      endedAt: now,
    });
  } catch (err) {
    logger.warn('Socket emit on meeting shutdown failed:', err);
  }

  try {
    await postRecordingToTeamChat(updated.id);
  } catch (chatErr) {
    logger.warn('Failed to post recording to team chat on active stop:', chatErr);
  }

  return serializeRecording(updated);
};

export const purgeExpiredRecordings = async () => {
  await ensureRecordingSchema();
  const now = new Date();

  const expiredRecordings = await prisma.meetingRecording.findMany({
    where: {
      expiresAt: { lte: now },
      status: { not: RecordingStatus.RECORDING },
    },
    take: 100,
  });

  if (expiredRecordings.length === 0) {
    return { purgedCount: 0 };
  }

  let purgedCount = 0;
  for (const item of expiredRecordings) {
    try {
      if ((item.fileUrl || item.thumbnailUrl || item.transcriptUrl) && !isS3Configured()) {
        logger.warn(`Skipping purge of recording ${item.id} because cloud storage is not configured; preserving references`);
        continue;
      }

      if (isS3Configured()) {
        if (item.fileUrl) {
          const fileDeleted = await deleteS3Object(item.fileUrl);
          if (!fileDeleted) {
            logger.error(`Failed to delete S3 video file for expired recording ${item.id}, skipping database deletion to avoid orphaned files`);
            continue;
          }
        }
        if (item.thumbnailUrl) {
          const thumbDeleted = await deleteS3Object(item.thumbnailUrl);
          if (!thumbDeleted) {
            logger.error(`Failed to delete S3 thumbnail file for expired recording ${item.id}, skipping database deletion to avoid orphaned files`);
            continue;
          }
        }
        if (item.transcriptUrl) {
          const transcriptDeleted = await deleteS3Object(item.transcriptUrl);
          if (!transcriptDeleted) {
            logger.error(`Failed to delete S3 transcript file for expired recording ${item.id}, skipping database deletion to avoid orphaned files`);
            continue;
          }
        }
      }

      await prisma.meetingRecording.delete({
        where: { id: item.id },
      });
      purgedCount++;
    } catch (err) {
      logger.error(`Failed to purge recording ${item.id}:`, err);
    }
  }

  return { purgedCount };
};

export const startRecordingCleanupTask = () => {
  const runCleanup = async () => {
    const lockKey = 'lock:recording_auto_purge';
    let lockAcquired = false;
    try {
      const res = await redis.set(lockKey, 'locked', 'EX', 300, 'NX');
      lockAcquired = res === 'OK';
      if (!lockAcquired) return;
      await purgeExpiredRecordings();
    } catch (err) {
      logger.error('Failed to run recording auto purge task:', err);
    } finally {
      if (lockAcquired) {
        await redis.del(lockKey).catch(() => {});
      }
    }
  };

  runCleanup();
  const interval = setInterval(runCleanup, 6 * 60 * 60 * 1000);
  return () => clearInterval(interval);
};

export const postRecordingToTeamChat = async (recordingId: string) => {
  await ensureRecordingSchema();

  const recording = await prisma.meetingRecording.findUnique({
    where: { id: recordingId },
    include: {
      recordedBy: { select: { id: true, name: true, avatar: true, email: true } },
    },
  });

  if (!recording) return null;

  const meeting = await prisma.meeting.findFirst({
    where: {
      OR: [
        { id: recording.meetingId || undefined },
        { code: recording.meetingCode },
      ],
    },
    include: {
      team: { select: { id: true, name: true, organizationId: true } },
      host: { select: { id: true, name: true, avatar: true, email: true } },
    },
  });

  const teamId = meeting?.teamId;
  if (!teamId || meeting?.scopeType !== MeetingScopeType.TEAM) return null;

  const senderId = recording.recordedById || meeting?.hostId;
  if (!senderId) return null;

  let conversation = await prisma.conversation.findUnique({
    where: { teamId },
  });

  if (conversation && conversation.type !== 'team') return null;

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        type: 'team',
        teamId,
        name: meeting.team?.name || 'Team Chat',
        ownerId: meeting.hostId || senderId,
      },
    });
  }

  const teamMembers = await prisma.teamMember.findMany({
    where: { teamId },
    select: { userId: true, role: true },
  });

  for (const tm of teamMembers) {
    await prisma.conversationParticipant.upsert({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: tm.userId,
        },
      },
      update: {},
      create: {
        conversationId: conversation.id,
        userId: tm.userId,
        role: tm.role === 'LEAD' ? 'admin' : 'member',
      },
    });
  }

  await prisma.conversationParticipant.upsert({
    where: {
      conversationId_userId: {
        conversationId: conversation.id,
        userId: senderId,
      },
    },
    update: {},
    create: {
      conversationId: conversation.id,
      userId: senderId,
      role: 'member',
    },
  });

  const meetingTitle = meeting.title?.trim() || `Meeting ${meeting.code}`;
  const durationSec = recording.durationSeconds || 0;
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;
  const durationText = durationSec > 0 ? (mins > 0 ? `${mins}m ${secs}s` : `${secs}s`) : '';

  let contentText = durationText
    ? `🎥 Meeting Recording: ${meetingTitle} (${durationText})`
    : `🎥 Meeting Recording: ${meetingTitle}`;

  if (!recording.fileUrl && recording.status === RecordingStatus.PROCESSING) {
    contentText += `\nStatus: Processing recording...`;
  }

  if (recording.summary) {
    contentText += `\n\nSummary:\n${recording.summary}`;
  }

  const clientMessageId = `recording_${recording.id}`;
  const sanitizedTitle = meetingTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${sanitizedTitle}_recording.mp4`;
  const fileSizeNum = recording.fileSizeBytes
    ? Math.min(Number(recording.fileSizeBytes), 2147483647)
    : null;

  const existingMessage = await prisma.message.findUnique({
    where: {
      conversationId_senderId_clientMessageId: {
        conversationId: conversation.id,
        senderId,
        clientMessageId,
      },
    },
    include: {
      sender: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
  });

  let message: any;

  if (existingMessage) {
    message = await prisma.message.update({
      where: { id: existingMessage.id },
      data: {
        content: contentText,
        fileUrl: recording.fileUrl || existingMessage.fileUrl,
        fileType: 'video',
        fileName: fileName || existingMessage.fileName,
        fileSize: fileSizeNum || existingMessage.fileSize,
        updatedAt: new Date(),
      },
      include: {
        sender: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    });

    const formattedMessage = {
      ...message,
      reactions: [],
      poll: null,
      mentionedUsers: [],
    };

    try {
      const io = getIO();
      if (io) {
        io.to(`conversation:${conversation.id}`)
          .to(conversation.id)
          .emit('chat:message:update', formattedMessage);
        io.to(`conversation:${conversation.id}`)
          .to(conversation.id)
          .emit(CHAT_EVENTS.MESSAGE_UPDATED, formattedMessage);

        teamMembers.forEach((tm) => {
          io.to(`user:${tm.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
            conversationId: conversation.id,
            lastMessage: formattedMessage,
          });
        });
      }
    } catch (socketErr) {
      logger.warn('Failed to emit recording message update to socket', socketErr);
    }
  } else {
    message = await prisma.$transaction(async (tx) => {
      const lastMessage = await tx.message.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });

      const currentMaxSeq = Math.max(conversation.lastSeq || 0, lastMessage?.seq || 0);
      const nextSeq = currentMaxSeq + 1;

      const created = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId,
          content: contentText,
          fileUrl: recording.fileUrl || null,
          fileType: 'video',
          fileName,
          fileSize: fileSizeNum,
          clientMessageId,
          seq: nextSeq,
        },
        include: {
          sender: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastSeq: nextSeq,
          updatedAt: new Date(),
        },
      });

      return created;
    });

    const formattedMessage = {
      ...message,
      reactions: [],
      poll: null,
      mentionedUsers: [],
    };

    try {
      const io = getIO();
      if (io) {
        io.to(`conversation:${conversation.id}`)
          .to(conversation.id)
          .emit('chat:message:new', formattedMessage);
        io.to(`conversation:${conversation.id}`)
          .to(conversation.id)
          .emit(CHAT_EVENTS.MESSAGE_NEW, formattedMessage);

        teamMembers.forEach((tm) => {
          io.to(`user:${tm.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
            conversationId: conversation.id,
            lastMessage: formattedMessage,
          });
        });
      }
    } catch (socketErr) {
      logger.warn('Failed to emit recording message to socket', socketErr);
    }

    try {
      const recipientIds = teamMembers
        .map((m) => m.userId)
        .filter((uid) => uid !== senderId);

      if (recipientIds.length > 0) {
        const teamName = meeting.team?.name || 'Team';
        const preview = contentText.length > 100 ? `${contentText.slice(0, 97)}...` : contentText;

        sendPushToOfflineUsers(
          recipientIds,
          `${teamName} • ${message.sender?.name || 'Meeting Recording'}`,
          preview,
          {
            conversationId: conversation.id,
            messageId: message.id,
            teamId,
            teamName,
            type: 'CHAT_MESSAGE',
          },
          {
            conversationId: conversation.id,
            tag: conversation.id,
            category: 'MESSAGE_REPLY',
            imageUrl: message.sender?.avatar || undefined,
            channelId: 'quorum_chat_messages',
            sound: 'default',
            forcePush: true,
          }
        ).catch((err: any) => {
          logger.warn('Failed to send team recording message push', err);
        });
      }
    } catch (pushErr) {
      logger.warn('Failed to dispatch push notification for team recording', pushErr);
    }
  }

  return message;
};
