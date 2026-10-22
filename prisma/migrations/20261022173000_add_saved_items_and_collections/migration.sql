DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SavedItemType') THEN
        CREATE TYPE "SavedItemType" AS ENUM ('MESSAGE', 'FILE', 'CHAT', 'DOCUMENT', 'RESOURCE');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SavedCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedCollection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SavedCollection_userId_name_key" ON "SavedCollection"("userId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "SavedCollection_userId_lower_name_key" ON "SavedCollection"("userId", lower("name"));
CREATE INDEX IF NOT EXISTS "SavedCollection_userId_idx" ON "SavedCollection"("userId");

CREATE TABLE IF NOT EXISTS "SavedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemType" "SavedItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "note" TEXT,
    "collectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SavedItem_userId_itemType_itemId_key" ON "SavedItem"("userId", "itemType", "itemId");
CREATE INDEX IF NOT EXISTS "SavedItem_userId_idx" ON "SavedItem"("userId");
CREATE INDEX IF NOT EXISTS "SavedItem_userId_itemType_idx" ON "SavedItem"("userId", "itemType");
CREATE INDEX IF NOT EXISTS "SavedItem_collectionId_idx" ON "SavedItem"("collectionId");
CREATE INDEX IF NOT EXISTS "SavedItem_createdAt_idx" ON "SavedItem"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SavedCollection_userId_fkey'
    ) THEN
        ALTER TABLE "SavedCollection" ADD CONSTRAINT "SavedCollection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SavedItem_userId_fkey'
    ) THEN
        ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SavedItem_collectionId_fkey'
    ) THEN
        ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "SavedCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
