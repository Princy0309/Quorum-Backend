CREATE TABLE IF NOT EXISTS "CommunityChannel" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityChannel_communityId_name_key" ON "CommunityChannel"("communityId", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityChannel_communityId_lower_name_key" ON "CommunityChannel"("communityId", lower("name"));

CREATE INDEX IF NOT EXISTS "CommunityChannel_communityId_idx" ON "CommunityChannel"("communityId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommunityChannel_communityId_fkey'
    ) THEN
        ALTER TABLE "CommunityChannel" ADD CONSTRAINT "CommunityChannel_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CommunityPost' AND column_name = 'channelId'
    ) THEN
        ALTER TABLE "CommunityPost" ADD COLUMN "channelId" TEXT;
    END IF;
END $$;

INSERT INTO "CommunityChannel" ("id", "communityId", "name", "description", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'General', 'Announcements and general discussions', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Community" c
WHERE NOT EXISTS (
    SELECT 1 FROM "CommunityChannel" ch WHERE ch."communityId" = c."id" AND (ch."isDefault" = true OR lower(ch."name") = 'general')
);

UPDATE "CommunityPost" p
SET "channelId" = (
    SELECT ch."id"
    FROM "CommunityChannel" ch
    WHERE ch."communityId" = p."communityId"
    ORDER BY ch."isDefault" DESC, ch."createdAt" ASC
    LIMIT 1
)
WHERE p."channelId" IS NULL;

ALTER TABLE "CommunityPost" ALTER COLUMN "channelId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "CommunityPost_channelId_idx" ON "CommunityPost"("channelId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommunityPost_channelId_fkey'
    ) THEN
        ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CommunityChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
