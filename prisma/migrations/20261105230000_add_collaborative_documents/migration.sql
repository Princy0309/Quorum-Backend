DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentScopeType') THEN
        CREATE TYPE "DocumentScopeType" AS ENUM ('PERSONAL', 'ORGANIZATION', 'TEAM', 'PROJECT');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentPermission') THEN
        CREATE TYPE "DocumentPermission" AS ENUM ('VIEW', 'COMMENT', 'EDIT');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    "scopeType" "DocumentScopeType" NOT NULL DEFAULT 'PERSONAL',
    "createdById" TEXT NOT NULL,
    "organizationId" TEXT,
    "teamId" TEXT,
    "projectId" TEXT,
    "meetingId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Document_organizationId_idx" ON "Document"("organizationId");
CREATE INDEX IF NOT EXISTS "Document_createdById_idx" ON "Document"("createdById");
CREATE INDEX IF NOT EXISTS "Document_teamId_idx" ON "Document"("teamId");
CREATE INDEX IF NOT EXISTS "Document_projectId_idx" ON "Document"("projectId");
CREATE INDEX IF NOT EXISTS "Document_meetingId_idx" ON "Document"("meetingId");
CREATE INDEX IF NOT EXISTS "Document_scopeType_idx" ON "Document"("scopeType");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_createdById_fkey') THEN
        ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_organizationId_fkey') THEN
        ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_teamId_fkey') THEN
        ALTER TABLE "Document" ADD CONSTRAINT "Document_teamId_fkey"
            FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_projectId_fkey') THEN
        ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey"
            FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_meetingId_fkey') THEN
        ALTER TABLE "Document" ADD CONSTRAINT "Document_meetingId_fkey"
            FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DocumentCollaborator" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "DocumentPermission" NOT NULL DEFAULT 'EDIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentCollaborator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentCollaborator_documentId_userId_key" ON "DocumentCollaborator"("documentId", "userId");
CREATE INDEX IF NOT EXISTS "DocumentCollaborator_documentId_idx" ON "DocumentCollaborator"("documentId");
CREATE INDEX IF NOT EXISTS "DocumentCollaborator_userId_idx" ON "DocumentCollaborator"("userId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentCollaborator_documentId_fkey') THEN
        ALTER TABLE "DocumentCollaborator" ADD CONSTRAINT "DocumentCollaborator_documentId_fkey"
            FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentCollaborator_userId_fkey') THEN
        ALTER TABLE "DocumentCollaborator" ADD CONSTRAINT "DocumentCollaborator_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DocumentMeeting" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentMeeting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentMeeting_documentId_meetingId_key" ON "DocumentMeeting"("documentId", "meetingId");
CREATE INDEX IF NOT EXISTS "DocumentMeeting_documentId_idx" ON "DocumentMeeting"("documentId");
CREATE INDEX IF NOT EXISTS "DocumentMeeting_meetingId_idx" ON "DocumentMeeting"("meetingId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentMeeting_documentId_fkey') THEN
        ALTER TABLE "DocumentMeeting" ADD CONSTRAINT "DocumentMeeting_documentId_fkey"
            FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentMeeting_meetingId_fkey') THEN
        ALTER TABLE "DocumentMeeting" ADD CONSTRAINT "DocumentMeeting_meetingId_fkey"
            FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DocumentWhiteboard" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "whiteboardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentWhiteboard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentWhiteboard_documentId_whiteboardId_key" ON "DocumentWhiteboard"("documentId", "whiteboardId");
CREATE INDEX IF NOT EXISTS "DocumentWhiteboard_documentId_idx" ON "DocumentWhiteboard"("documentId");
CREATE INDEX IF NOT EXISTS "DocumentWhiteboard_whiteboardId_idx" ON "DocumentWhiteboard"("whiteboardId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentWhiteboard_documentId_fkey') THEN
        ALTER TABLE "DocumentWhiteboard" ADD CONSTRAINT "DocumentWhiteboard_documentId_fkey"
            FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentWhiteboard_whiteboardId_fkey') THEN
        ALTER TABLE "DocumentWhiteboard" ADD CONSTRAINT "DocumentWhiteboard_whiteboardId_fkey"
            FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
