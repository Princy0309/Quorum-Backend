-- AlterTable: Add organizationId to Meeting if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Meeting' AND column_name = 'organizationId'
    ) THEN
        ALTER TABLE "Meeting" ADD COLUMN "organizationId" TEXT;
    END IF;
END $$;

-- CreateIndex on Meeting(organizationId)
CREATE INDEX IF NOT EXISTS "Meeting_organizationId_idx" ON "Meeting"("organizationId");

-- AddForeignKey from Meeting to Organization
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Meeting_organizationId_fkey'
    ) THEN
        ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizationId_fkey" 
            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: Whiteboard
CREATE TABLE IF NOT EXISTS "Whiteboard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{"elements":[],"viewState":{}}'::jsonb,
    "createdById" TEXT NOT NULL,
    "meetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Whiteboard_pkey" PRIMARY KEY ("id")
);

-- Indexes on Whiteboard
CREATE INDEX IF NOT EXISTS "Whiteboard_organizationId_idx" ON "Whiteboard"("organizationId");
CREATE INDEX IF NOT EXISTS "Whiteboard_createdById_idx" ON "Whiteboard"("createdById");
CREATE INDEX IF NOT EXISTS "Whiteboard_meetingId_idx" ON "Whiteboard"("meetingId");

-- Foreign Keys on Whiteboard
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Whiteboard_organizationId_fkey'
    ) THEN
        ALTER TABLE "Whiteboard" ADD CONSTRAINT "Whiteboard_organizationId_fkey" 
            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Whiteboard_createdById_fkey'
    ) THEN
        ALTER TABLE "Whiteboard" ADD CONSTRAINT "Whiteboard_createdById_fkey" 
            FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Whiteboard_meetingId_fkey'
    ) THEN
        ALTER TABLE "Whiteboard" ADD CONSTRAINT "Whiteboard_meetingId_fkey" 
            FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: WhiteboardMeeting
CREATE TABLE IF NOT EXISTS "WhiteboardMeeting" (
    "id" TEXT NOT NULL,
    "whiteboardId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhiteboardMeeting_pkey" PRIMARY KEY ("id")
);

-- Unique index and foreign keys on WhiteboardMeeting
CREATE UNIQUE INDEX IF NOT EXISTS "WhiteboardMeeting_whiteboardId_meetingId_key" ON "WhiteboardMeeting"("whiteboardId", "meetingId");
CREATE INDEX IF NOT EXISTS "WhiteboardMeeting_whiteboardId_idx" ON "WhiteboardMeeting"("whiteboardId");
CREATE INDEX IF NOT EXISTS "WhiteboardMeeting_meetingId_idx" ON "WhiteboardMeeting"("meetingId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WhiteboardMeeting_whiteboardId_fkey'
    ) THEN
        ALTER TABLE "WhiteboardMeeting" ADD CONSTRAINT "WhiteboardMeeting_whiteboardId_fkey" 
            FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WhiteboardMeeting_meetingId_fkey'
    ) THEN
        ALTER TABLE "WhiteboardMeeting" ADD CONSTRAINT "WhiteboardMeeting_meetingId_fkey" 
            FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
