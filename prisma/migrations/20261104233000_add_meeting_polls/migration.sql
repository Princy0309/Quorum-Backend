DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MeetingPollStatus') THEN
        CREATE TYPE "MeetingPollStatus" AS ENUM ('ACTIVE', 'CLOSED');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MeetingPoll" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "allowMultipleAnswers" BOOLEAN NOT NULL DEFAULT false,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "MeetingPollStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingPoll_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MeetingPollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingPollOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MeetingPollVote" (
    "id" TEXT NOT NULL,
    "pollOptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingPollVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MeetingPollVote_pollOptionId_userId_key" ON "MeetingPollVote"("pollOptionId", "userId");

CREATE INDEX IF NOT EXISTS "MeetingPoll_meetingId_idx" ON "MeetingPoll"("meetingId");
CREATE INDEX IF NOT EXISTS "MeetingPoll_creatorId_idx" ON "MeetingPoll"("creatorId");
CREATE INDEX IF NOT EXISTS "MeetingPoll_meetingId_status_idx" ON "MeetingPoll"("meetingId", "status");
CREATE INDEX IF NOT EXISTS "MeetingPollOption_pollId_idx" ON "MeetingPollOption"("pollId");
CREATE INDEX IF NOT EXISTS "MeetingPollVote_pollOptionId_idx" ON "MeetingPollVote"("pollOptionId");
CREATE INDEX IF NOT EXISTS "MeetingPollVote_userId_idx" ON "MeetingPollVote"("userId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingPoll_meetingId_fkey') THEN
        ALTER TABLE "MeetingPoll" ADD CONSTRAINT "MeetingPoll_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingPoll_creatorId_fkey') THEN
        ALTER TABLE "MeetingPoll" ADD CONSTRAINT "MeetingPoll_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingPollOption_pollId_fkey') THEN
        ALTER TABLE "MeetingPollOption" ADD CONSTRAINT "MeetingPollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "MeetingPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingPollVote_pollOptionId_fkey') THEN
        ALTER TABLE "MeetingPollVote" ADD CONSTRAINT "MeetingPollVote_pollOptionId_fkey" FOREIGN KEY ("pollOptionId") REFERENCES "MeetingPollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingPollVote_userId_fkey') THEN
        ALTER TABLE "MeetingPollVote" ADD CONSTRAINT "MeetingPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
