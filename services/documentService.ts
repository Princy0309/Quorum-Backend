import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { getIO } from '../sockets/socketServer.js';
import { generateRawCompletion } from './aiService.js';
import {
  CreateDocumentInput,
  UpdateDocumentInput,
  AddCollaboratorInput,
  DocumentAiPromptInput,
} from '../validators/documentValidators.js';

let isSchemaEnsured = false;

export const ensureDocumentSchema = async (): Promise<void> => {
  if (isSchemaEnsured) return;

  const ddlStatements = [
    `DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentScopeType') THEN
            CREATE TYPE "DocumentScopeType" AS ENUM ('PERSONAL', 'ORGANIZATION', 'TEAM', 'PROJECT');
        END IF;
    END $$;`,

    `DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentPermission') THEN
            CREATE TYPE "DocumentPermission" AS ENUM ('VIEW', 'COMMENT', 'EDIT');
        END IF;
    END $$;`,

    `CREATE TABLE IF NOT EXISTS "Document" (
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
    );`,

    `CREATE INDEX IF NOT EXISTS "Document_organizationId_idx" ON "Document"("organizationId");`,
    `CREATE INDEX IF NOT EXISTS "Document_createdById_idx" ON "Document"("createdById");`,
    `CREATE INDEX IF NOT EXISTS "Document_teamId_idx" ON "Document"("teamId");`,
    `CREATE INDEX IF NOT EXISTS "Document_projectId_idx" ON "Document"("projectId");`,
    `CREATE INDEX IF NOT EXISTS "Document_meetingId_idx" ON "Document"("meetingId");`,
    `CREATE INDEX IF NOT EXISTS "Document_scopeType_idx" ON "Document"("scopeType");`,

    `CREATE TABLE IF NOT EXISTS "DocumentCollaborator" (
        "id" TEXT NOT NULL,
        "documentId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "permission" "DocumentPermission" NOT NULL DEFAULT 'EDIT',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DocumentCollaborator_pkey" PRIMARY KEY ("id")
    );`,

    `CREATE UNIQUE INDEX IF NOT EXISTS "DocumentCollaborator_documentId_userId_key" ON "DocumentCollaborator"("documentId", "userId");`,

    `CREATE TABLE IF NOT EXISTS "DocumentMeeting" (
        "id" TEXT NOT NULL,
        "documentId" TEXT NOT NULL,
        "meetingId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DocumentMeeting_pkey" PRIMARY KEY ("id")
    );`,

    `CREATE UNIQUE INDEX IF NOT EXISTS "DocumentMeeting_documentId_meetingId_key" ON "DocumentMeeting"("documentId", "meetingId");`,

    `CREATE TABLE IF NOT EXISTS "DocumentWhiteboard" (
        "id" TEXT NOT NULL,
        "documentId" TEXT NOT NULL,
        "whiteboardId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DocumentWhiteboard_pkey" PRIMARY KEY ("id")
    );`,

    `CREATE UNIQUE INDEX IF NOT EXISTS "DocumentWhiteboard_documentId_whiteboardId_key" ON "DocumentWhiteboard"("documentId", "whiteboardId");`
  ];

  for (const query of ddlStatements) {
    try {
      await prisma.$executeRawUnsafe(query);
    } catch (e: any) {
      logger.warn(`Document schema self-healing warning: ${e?.message}`);
    }
  }

  isSchemaEnsured = true;
};

export const checkDocumentAccess = async (
  userId: string,
  documentId: string,
  requiredPermission: 'VIEW' | 'COMMENT' | 'EDIT' = 'VIEW',
  meetingCode?: string
) => {
  await ensureDocumentSchema();

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      collaborators: true,
      meetings: {
        include: {
          meeting: {
            select: { id: true, code: true, hostId: true }
          }
        }
      }
    }
  });

  if (!doc) {
    throw new ApiError(404, 'Document not found');
  }

  if (doc.createdById === userId) {
    return { doc, permission: 'EDIT' as const, isCreator: true };
  }

  const directCollab = doc.collaborators.find((c) => c.userId === userId);
  if (directCollab) {
    if (requiredPermission === 'EDIT' && directCollab.permission !== 'EDIT') {
      throw new ApiError(403, 'You only have view/comment permissions for this document');
    }
    return { doc, permission: directCollab.permission, isCreator: false };
  }

  if (meetingCode) {
    const meeting = await prisma.meeting.findFirst({
      where: {
        code: meetingCode.trim().toLowerCase(),
        status: { in: ['ACTIVE', 'SCHEDULED'] }
      }
    });

    if (meeting) {
      const isLinkedToMeeting = doc.meetings.some((dm) => dm.meetingId === meeting.id) || doc.meetingId === meeting.id;
      if (isLinkedToMeeting) {
        return { doc, permission: 'EDIT' as const, isCreator: false, isMeetingParticipant: true };
      }
    }
  }

  if (doc.organizationId) {
    const orgMembership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: doc.organizationId,
          userId
        }
      }
    });

    if (orgMembership) {
      return { doc, permission: 'EDIT' as const, isCreator: false };
    }
  }

  if (doc.projectId) {
    const projectMember = await prisma.projectMember.findFirst({
      where: {
        projectId: doc.projectId,
        userId
      }
    });

    if (projectMember) {
      return { doc, permission: 'EDIT' as const, isCreator: false };
    }
  }

  throw new ApiError(403, 'You do not have permission to access this document');
};

export const createDocument = async (userId: string, input: CreateDocumentInput) => {
  await ensureDocumentSchema();

  const title = input.title.trim();
  const initialContent = input.content ?? {
    type: 'doc',
    content: [{ type: 'paragraph' }]
  };

  let resolvedMeetingId = input.meetingId;
  if (!resolvedMeetingId && input.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: input.organizationId }
    });
    if (!org) {
      throw new ApiError(404, 'Organization not found');
    }
  }

  const document = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        title,
        content: initialContent,
        scopeType: input.scopeType ?? 'PERSONAL',
        createdById: userId,
        organizationId: input.organizationId,
        teamId: input.teamId,
        projectId: input.projectId,
        meetingId: resolvedMeetingId,
        collaborators: {
          create: {
            userId,
            permission: 'EDIT'
          }
        },
        ...(input.whiteboardId ? {
          whiteboards: {
            create: {
              whiteboardId: input.whiteboardId
            }
          }
        } : {}),
        ...(resolvedMeetingId ? {
          meetings: {
            create: {
              meetingId: resolvedMeetingId
            }
          }
        } : {})
      },
      include: {
        createdBy: {
          select: { id: true, name: true, avatar: true, email: true }
        },
        collaborators: {
          include: {
            user: {
              select: { id: true, name: true, avatar: true }
            }
          }
        },
        whiteboards: {
          include: {
            whiteboard: {
              select: { id: true, name: true }
            }
          }
        },
        meetings: {
          include: {
            meeting: {
              select: { id: true, code: true, title: true }
            }
          }
        }
      }
    });

    return doc;
  });

  return document;
};

export const getDocumentById = async (userId: string, documentId: string, meetingCode?: string) => {
  const { doc, permission, isCreator } = await checkDocumentAccess(userId, documentId, 'VIEW', meetingCode);

  const fullDoc = await prisma.document.findUnique({
    where: { id: doc.id },
    include: {
      createdBy: {
        select: { id: true, name: true, avatar: true, email: true }
      },
      collaborators: {
        include: {
          user: {
            select: { id: true, name: true, avatar: true }
          }
        }
      },
      whiteboards: {
        include: {
          whiteboard: {
            select: { id: true, name: true }
          }
        }
      },
      meetings: {
        include: {
          meeting: {
            select: { id: true, code: true, title: true }
          }
        }
      }
    }
  });

  return {
    ...fullDoc,
    userPermission: permission,
    isCreator
  };
};

export const listUserDocuments = async (
  userId: string,
  query?: {
    scopeType?: string;
    organizationId?: string;
    projectId?: string;
    teamId?: string;
    search?: string;
  }
) => {
  await ensureDocumentSchema();

  const whereClause: any = {
    isArchived: false,
    OR: [
      { createdById: userId },
      { collaborators: { some: { userId } } },
      ...(query?.organizationId ? [{ organizationId: query.organizationId }] : []),
      ...(query?.projectId ? [{ projectId: query.projectId }] : [])
    ]
  };

  if (query?.scopeType) {
    whereClause.scopeType = query.scopeType;
  }
  if (query?.organizationId) {
    whereClause.organizationId = query.organizationId;
  }
  if (query?.projectId) {
    whereClause.projectId = query.projectId;
  }
  if (query?.teamId) {
    whereClause.teamId = query.teamId;
  }
  if (query?.search && query.search.trim()) {
    whereClause.title = {
      contains: query.search.trim(),
      mode: 'insensitive'
    };
  }

  const documents = await prisma.document.findMany({
    where: whereClause,
    orderBy: { updatedAt: 'desc' },
    include: {
      createdBy: {
        select: { id: true, name: true, avatar: true }
      },
      collaborators: {
        select: {
          userId: true,
          permission: true,
          user: {
            select: { id: true, name: true, avatar: true }
          }
        }
      },
      meetings: {
        include: {
          meeting: {
            select: { id: true, code: true, title: true }
          }
        }
      }
    }
  });

  return documents;
};

export const updateDocument = async (userId: string, documentId: string, input: UpdateDocumentInput) => {
  const { doc } = await checkDocumentAccess(userId, documentId, 'EDIT');

  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: {
      ...(input.title ? { title: input.title.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content, version: { increment: 1 } } : {}),
      ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
      updatedAt: new Date()
    },
    include: {
      createdBy: {
        select: { id: true, name: true, avatar: true }
      },
      collaborators: {
        include: {
          user: {
            select: { id: true, name: true, avatar: true }
          }
        }
      }
    }
  });

  try {
    const io = getIO();
    io.to(`document:${documentId}`).emit('document:updated', {
      documentId,
      version: updated.version,
      updatedBy: userId,
      updatedAt: updated.updatedAt
    });
  } catch (err: any) {
    logger.error('Failed to emit document:updated socket event', { error: err.message });
  }

  return updated;
};

export const deleteDocument = async (userId: string, documentId: string) => {
  await ensureDocumentSchema();

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, createdById: true, organizationId: true }
  });

  if (!doc) {
    throw new ApiError(404, 'Document not found');
  }

  let isAllowed = doc.createdById === userId;
  if (!isAllowed && doc.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: doc.organizationId },
      select: { ownerId: true }
    });
    isAllowed = org?.ownerId === userId;
  }

  if (!isAllowed) {
    throw new ApiError(403, 'Only the document creator or organization owner can delete this document');
  }

  await prisma.document.delete({
    where: { id: documentId }
  });

  try {
    const io = getIO();
    io.to(`document:${documentId}`).emit('document:deleted', { documentId, deletedBy: userId });
  } catch (err: any) {
    logger.error('Failed to emit document:deleted socket event', { error: err.message });
  }

  return { success: true, documentId };
};

export const addCollaborator = async (userId: string, documentId: string, input: AddCollaboratorInput) => {
  await checkDocumentAccess(userId, documentId, 'EDIT');

  const collaborator = await prisma.documentCollaborator.upsert({
    where: {
      documentId_userId: {
        documentId,
        userId: input.userId
      }
    },
    create: {
      documentId,
      userId: input.userId,
      permission: input.permission
    },
    update: {
      permission: input.permission
    },
    include: {
      user: {
        select: { id: true, name: true, avatar: true, email: true }
      }
    }
  });

  return collaborator;
};

export const removeCollaborator = async (userId: string, documentId: string, targetUserId: string) => {
  const { doc, isCreator } = await checkDocumentAccess(userId, documentId, 'VIEW');

  if (!isCreator && userId !== targetUserId) {
    throw new ApiError(403, 'Only the document creator can remove other collaborators');
  }

  await prisma.documentCollaborator.deleteMany({
    where: {
      documentId,
      userId: targetUserId
    }
  });

  return { success: true, removedUserId: targetUserId };
};

export const openDocumentInMeeting = async (userId: string, documentId: string, meetingCode: string) => {
  const { doc } = await checkDocumentAccess(userId, documentId, 'VIEW');

  const meeting = await prisma.meeting.findFirst({
    where: {
      code: meetingCode.trim().toLowerCase(),
      status: { in: ['ACTIVE', 'SCHEDULED'] }
    }
  });

  if (!meeting) {
    throw new ApiError(404, 'Active meeting not found');
  }

  await prisma.documentMeeting.upsert({
    where: {
      documentId_meetingId: {
        documentId,
        meetingId: meeting.id
      }
    },
    create: {
      documentId,
      meetingId: meeting.id
    },
    update: {}
  });

  try {
    const io = getIO();
    io.to(meeting.code).emit('meeting:document-opened', {
      meetingCode: meeting.code,
      documentId: doc.id,
      title: doc.title,
      openedBy: userId
    });
  } catch (err: any) {
    logger.error('Failed to emit meeting:document-opened socket event', { error: err.message });
  }

  return {
    success: true,
    documentId: doc.id,
    meetingCode: meeting.code
  };
};

export const embedWhiteboardInDocument = async (userId: string, documentId: string, whiteboardId: string) => {
  await checkDocumentAccess(userId, documentId, 'EDIT');

  const whiteboard = await prisma.whiteboard.findUnique({
    where: { id: whiteboardId }
  });

  if (!whiteboard) {
    throw new ApiError(404, 'Whiteboard not found');
  }

  const link = await prisma.documentWhiteboard.upsert({
    where: {
      documentId_whiteboardId: {
        documentId,
        whiteboardId
      }
    },
    create: {
      documentId,
      whiteboardId
    },
    update: {},
    include: {
      whiteboard: {
        select: { id: true, name: true }
      }
    }
  });

  return link;
};

export const executeDocumentAi = async (userId: string, documentId: string, input: DocumentAiPromptInput) => {
  await checkDocumentAccess(userId, documentId, 'EDIT');

  let systemInstruction = 'You are an intelligent collaborative document writing assistant inside Quorum Docs. Output clean, concise, directly usable markdown formatting without conversational filler.';
  let prompt = '';

  const contextText = input.selectedText?.trim() || '';

  switch (input.action) {
    case 'summarize':
      prompt = `Summarize the following text into key bullet points and an executive takeaway:\n\n${contextText}`;
      break;
    case 'action_items':
      prompt = `Extract all action items, decisions, and tasks from the following text into a clean checklist with assigned owners and deadlines if present:\n\n${contextText}`;
      break;
    case 'rewrite':
      prompt = `Rewrite the following text to sound clear, engaging, and professional:\n\n${contextText}`;
      break;
    case 'expand':
      prompt = `Expand on the following thoughts with detailed supporting points, context, and clear explanations:\n\n${contextText}`;
      break;
    case 'fix_grammar':
      prompt = `Correct any spelling, grammatical, and punctuation errors in the following text while preserving its original meaning:\n\n${contextText}`;
      break;
    case 'custom':
      prompt = `${input.prompt || 'Improve the text'}:\n\n${contextText}`;
      break;
  }

  const result = await generateRawCompletion(prompt, systemInstruction);

  return {
    success: true,
    action: input.action,
    completion: result.text.trim(),
    model: result.model
  };
};
