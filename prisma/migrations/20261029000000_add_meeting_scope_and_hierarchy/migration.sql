-- 1. Create MeetingScopeType enum if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MeetingScopeType') THEN
        CREATE TYPE "MeetingScopeType" AS ENUM ('PERSONAL', 'ORGANIZATION', 'TEAM');
    END IF;
END $$;

-- 2. Add SCHEDULED and CANCELLED to MeetingStatus enum if not exists
ALTER TYPE "MeetingStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "MeetingStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- 3. Add columns to Meeting table if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Meeting' AND column_name = 'title') THEN
        ALTER TABLE "Meeting" ADD COLUMN "title" TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Meeting' AND column_name = 'scopeType') THEN
        ALTER TABLE "Meeting" ADD COLUMN "scopeType" "MeetingScopeType" NOT NULL DEFAULT 'PERSONAL';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Meeting' AND column_name = 'scheduledStartTime') THEN
        ALTER TABLE "Meeting" ADD COLUMN "scheduledStartTime" TIMESTAMP(3);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Meeting' AND column_name = 'organizationId') THEN
        ALTER TABLE "Meeting" ADD COLUMN "organizationId" TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Meeting' AND column_name = 'teamId') THEN
        ALTER TABLE "Meeting" ADD COLUMN "teamId" TEXT;
    END IF;
END $$;

-- 4. Foreign key constraint from Meeting to Team
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Meeting_teamId_fkey') THEN
        ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_teamId_fkey" 
            FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 4b. Foreign key constraint from Meeting to Organization
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Meeting_organizationId_fkey') THEN
        ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizationId_fkey" 
            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 5. Drop redundant code index if exists
DROP INDEX IF EXISTS "Meeting_code_idx";

-- 6. Create performance indexes
CREATE INDEX IF NOT EXISTS "Meeting_organizationId_idx" ON "Meeting"("organizationId");
CREATE INDEX IF NOT EXISTS "Meeting_organizationId_scheduledStartTime_idx" ON "Meeting"("organizationId", "scheduledStartTime");
CREATE INDEX IF NOT EXISTS "Meeting_teamId_idx" ON "Meeting"("teamId");
CREATE INDEX IF NOT EXISTS "Meeting_teamId_scheduledStartTime_idx" ON "Meeting"("teamId", "scheduledStartTime");
CREATE INDEX IF NOT EXISTS "Meeting_scopeType_idx" ON "Meeting"("scopeType");
CREATE INDEX IF NOT EXISTS "Meeting_scheduledStartTime_idx" ON "Meeting"("scheduledStartTime");

-- 7. Backfill existing records
UPDATE "Meeting" SET "scopeType" = 'PERSONAL' WHERE "scopeType" IS NULL;
