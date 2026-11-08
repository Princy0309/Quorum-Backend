DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingStatus') THEN
        CREATE TYPE "RecordingStatus" AS ENUM ('RECORDING', 'PROCESSING', 'COMPLETED', 'FAILED');
    END IF;
END $$;

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

CREATE INDEX IF NOT EXISTS "MeetingRecording_meetingId_idx" ON "MeetingRecording"("meetingId");
CREATE INDEX IF NOT EXISTS "MeetingRecording_meetingCode_idx" ON "MeetingRecording"("meetingCode");
CREATE INDEX IF NOT EXISTS "MeetingRecording_recordedById_idx" ON "MeetingRecording"("recordedById");
CREATE INDEX IF NOT EXISTS "MeetingRecording_expiresAt_idx" ON "MeetingRecording"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "MeetingRecording_single_active_idx" ON "MeetingRecording"("meetingCode") WHERE status = 'RECORDING';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingRecording_meetingId_fkey') THEN
        ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_meetingId_fkey"
            FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingRecording_recordedById_fkey') THEN
        ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_recordedById_fkey"
            FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
