import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { CHAT_EVENTS } from '../utils/constants.js';
import logger from '../utils/logger.js';
import { getIO } from '../sockets/socketServer.js';

export const safeEjectUserFromRoom = (conversationId: string, targetUserId: string, removedByUserId: string) => {
  try {
    const io = getIO();
    io.in(`user:${targetUserId}`).socketsLeave(`conversation:${conversationId}`);
    io.to(`user:${targetUserId}`).emit(CHAT_EVENTS.CONVERSATION_REMOVED, {
      conversationId,
      userId: targetUserId,
      removedBy: removedByUserId
    });
  } catch (err: any) {
    logger.error('Failed to eject socket room or dispatch removal event', { conversationId, targetUserId, error: err.message });
  }
};

const notifyConversationUpdate = (userIds: string[], conversationData: any) => {
  try {
    const io = getIO();
    userIds.forEach((uId) => {
      io.to(`user:${uId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
        conversationId: conversationData.id,
        conversation: conversationData
      });
    });
  } catch (err: any) {
    logger.error('Failed to emit conversation update event', { error: err.message });
  }
};

let isChatSchemaEnsured = false;

export const ensureChatSchema = async (): Promise<void> => {
  if (isChatSchemaEnsured) {
    return;
  }

  const ddlStatements = [
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "replyToId" TEXT;`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "isEdited" BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "isForwarded" BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "forwardCount" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "audioDuration" INTEGER;`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "audioWaveform" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[];`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedForUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];`,
    `CREATE INDEX IF NOT EXISTS "Message_replyToId_idx" ON "Message"("replyToId");`,
    `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_replyToId_fkey') THEN
            ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
    END $$;`,
    `CREATE TABLE IF NOT EXISTS "MessageReaction" (
        "id" TEXT NOT NULL,
        "messageId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "emoji" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "MessageReaction_messageId_userId_emoji_key" ON "MessageReaction"("messageId", "userId", "emoji");`,
    `CREATE INDEX IF NOT EXISTS "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");`,
    `CREATE INDEX IF NOT EXISTS "MessageReaction_userId_idx" ON "MessageReaction"("userId");`,
    `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageReaction_messageId_fkey') THEN
            ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageReaction_userId_fkey') THEN
            ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END $$;`,
    `CREATE TABLE IF NOT EXISTS "Poll" (
        "id" TEXT NOT NULL,
        "messageId" TEXT NOT NULL,
        "question" TEXT NOT NULL,
        "allowMultipleAnswers" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Poll_messageId_key" ON "Poll"("messageId");`,
    `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Poll_messageId_fkey') THEN
            ALTER TABLE "Poll" ADD CONSTRAINT "Poll_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END $$;`,
    `CREATE TABLE IF NOT EXISTS "PollOption" (
        "id" TEXT NOT NULL,
        "pollId" TEXT NOT NULL,
        "text" TEXT NOT NULL,
        "order" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE INDEX IF NOT EXISTS "PollOption_pollId_idx" ON "PollOption"("pollId");`,
    `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollOption_pollId_fkey') THEN
            ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END $$;`,
    `CREATE TABLE IF NOT EXISTS "PollVote" (
        "id" TEXT NOT NULL,
        "pollOptionId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "PollVote_pollOptionId_userId_key" ON "PollVote"("pollOptionId", "userId");`,
    `CREATE INDEX IF NOT EXISTS "PollVote_pollOptionId_idx" ON "PollVote"("pollOptionId");`,
    `CREATE INDEX IF NOT EXISTS "PollVote_userId_idx" ON "PollVote"("userId");`,
    `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollVote_pollOptionId_fkey') THEN
            ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_pollOptionId_fkey" FOREIGN KEY ("pollOptionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollVote_userId_fkey') THEN
            ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END $$;`
  ];

  for (const ddl of ddlStatements) {
    try {
      await prisma.$executeRawUnsafe(ddl);
    } catch (err: any) {
      logger.warn(`[ChatSchema] Statement failed: ${err.message}`);
    }
  }

  isChatSchemaEnsured = true;
};

export const getOrCreateDirectConversation = async (userId: string, targetUserId: string) => {
  await ensureChatSchema();
  if (userId === targetUserId) {
    throw new ApiError(400, 'Cannot start a direct message conversation with yourself');
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId }
  });

  if (!targetUser) {
    throw new ApiError(404, 'Target user not found');
  }

  const sortedIds = [userId, targetUserId].sort();
  const directKey = `${sortedIds[0]}_${sortedIds[1]}`;

  let conversation = await prisma.conversation.findUnique({
    where: { directKey },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true
            }
          }
        }
      },
      messages: {
        take: 1,
        orderBy: [{ seq: 'desc' }, { id: 'desc' }]
      }
    }
  });

  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({
        data: {
          type: 'direct',
          directKey,
          participants: {
            create: [
              { userId },
              { userId: targetUserId }
            ]
          }
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true
                }
              }
            }
          },
          messages: {
            take: 1,
            orderBy: [{ seq: 'desc' }, { id: 'desc' }]
          }
        }
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        conversation = await prisma.conversation.findUnique({
          where: { directKey },
          include: {
            participants: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    avatar: true
                  }
                }
              }
            },
            messages: {
              take: 1,
              orderBy: [{ seq: 'desc' }, { id: 'desc' }]
            }
          }
        });
      } else {
        throw err;
      }
    }
  }

  return conversation;
};

export const isParticipant = async (userId: string, conversationId: string): Promise<boolean> => {
  const participant = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId
      }
    }
  });
  return !!participant;
};

export const resolveConversationId = async (
  userId: string,
  conversationIdOrUserId: string
): Promise<string | null> => {
  const participant = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId: conversationIdOrUserId,
        userId
      }
    }
  });

  if (participant) {
    return conversationIdOrUserId;
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: conversationIdOrUserId }
  });

  if (targetUser && targetUser.id !== userId) {
    const directConv = await getOrCreateDirectConversation(userId, targetUser.id);
    return directConv ? directConv.id : null;
  }

  return null;
};

export const getConversationById = async (userId: string, conversationIdOrUserId: string) => {
  const resolvedId = await resolveConversationId(userId, conversationIdOrUserId);
  if (!resolvedId) {
    throw new ApiError(404, 'Conversation not found');
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: resolvedId },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true
            }
          }
        }
      },
      messages: {
        take: 1,
        orderBy: [{ seq: 'desc' }, { id: 'desc' }]
      }
    }
  });

  if (!conversation) {
    throw new ApiError(404, 'Conversation not found');
  }

  return conversation;
};

export const getCoParticipantUserIds = async (userId: string): Promise<string[]> => {
  const results: { userId: string }[] = await prisma.$queryRaw`
    SELECT DISTINCT cp2."userId"
    FROM "ConversationParticipant" cp1
    JOIN "ConversationParticipant" cp2 ON cp1."conversationId" = cp2."conversationId"
    WHERE cp1."userId" = ${userId}
      AND cp2."userId" <> ${userId}
  `;
  return results.map((row) => row.userId);
};

export const deriveFileTypeFromUrl = (fileUrl?: string): string | undefined => {
  if (!fileUrl) return undefined;

  try {
    const parsed = new URL(fileUrl);
    const pathname = parsed.pathname.toLowerCase();

    if (pathname.includes('/image/upload/') || pathname.includes('/images/')) {
      return 'image';
    }
    if (pathname.includes('/video/upload/') || pathname.includes('/videos/')) {
      return 'video';
    }
    if (pathname.includes('/audio/upload/') || pathname.includes('/audios/')) {
      return 'audio';
    }

    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.heic', '.avif'];
    const videoExts = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.flv', '.3gp', '.wmv'];
    const audioExts = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.opus', '.wma', '.m4b'];

    if (imageExts.some((ext) => pathname.endsWith(ext))) {
      return 'image';
    }
    if (videoExts.some((ext) => pathname.endsWith(ext))) {
      return 'video';
    }
    if (audioExts.some((ext) => pathname.endsWith(ext))) {
      return 'audio';
    }

    return 'file';
  } catch (err) {
    return 'file';
  }
};

export const formatReactions = (reactions: any[], currentUserId?: string) => {
  if (!Array.isArray(reactions) || reactions.length === 0) return [];
  const map = new Map<string, { userIds: string[]; users: { id: string; name: string; avatar: string | null }[] }>();
  for (const r of reactions) {
    if (!r?.emoji) continue;
    if (!map.has(r.emoji)) {
      map.set(r.emoji, { userIds: [], users: [] });
    }
    const group = map.get(r.emoji)!;
    if (r.userId) {
      group.userIds.push(r.userId);
      group.users.push({
        id: r.user?.id || r.userId,
        name: r.user?.name || 'User',
        avatar: r.user?.avatar || null
      });
    }
  }
  return Array.from(map.entries()).map(([emoji, data]) => ({
    emoji,
    count: data.userIds.length,
    hasReacted: Boolean(currentUserId && data.userIds.includes(currentUserId)),
    userIds: data.userIds,
    users: data.users
  }));
};

export const formatPoll = (poll: any, currentUserId?: string) => {
  if (!poll) return null;

  const options = (poll.options || []).map((opt: any) => {
    const votes = opt.votes || [];
    const voteCount = votes.length;
    const hasVoted = Boolean(currentUserId && votes.some((v: any) => v.userId === currentUserId));
    const voters = votes.map((v: any) => ({
      userId: v.userId,
      user: v.user ? {
        id: v.user.id,
        name: v.user.name,
        avatar: v.user.avatar
      } : null,
      createdAt: v.createdAt
    }));

    return {
      id: opt.id,
      text: opt.text,
      order: opt.order,
      voteCount,
      hasVoted,
      voters
    };
  });

  const totalVotes = options.reduce((sum: number, o: any) => sum + o.voteCount, 0);
  const uniqueVoterSet = new Set<string>();
  for (const opt of poll.options || []) {
    for (const v of opt.votes || []) {
      if (v.userId) uniqueVoterSet.add(v.userId);
    }
  }

  const userVotedOptionIds = options.filter((o: any) => o.hasVoted).map((o: any) => o.id);

  return {
    id: poll.id,
    question: poll.question,
    allowMultipleAnswers: poll.allowMultipleAnswers,
    createdAt: poll.createdAt,
    totalVotes,
    uniqueVotersCount: uniqueVoterSet.size,
    hasVoted: userVotedOptionIds.length > 0,
    userVotedOptionIds,
    options
  };
};

export const messageInclude = {
  sender: {
    select: {
      id: true,
      name: true,
      avatar: true
    }
  },
  replyTo: {
    select: {
      id: true,
      content: true,
      fileUrl: true,
      fileType: true,
      fileName: true,
      audioDuration: true,
      isDeleted: true,
      sender: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      poll: {
        select: {
          id: true,
          question: true
        }
      }
    }
  },
  reactions: {
    select: {
      id: true,
      emoji: true,
      userId: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  },
  poll: {
    include: {
      options: {
        orderBy: { order: 'asc' as const },
        include: {
          votes: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatar: true
                }
              }
            }
          }
        }
      }
    }
  }
};

export const saveMessage = async (
  senderId: string,
  conversationId: string,
  content: string,
  fileUrl?: string,
  fileType?: string,
  clientMessageId?: string,
  fileName?: string,
  fileSize?: number,
  mentions?: string[],
  replyToId?: string,
  audioDuration?: number,
  audioWaveform?: number[],
  pollData?: {
    question: string;
    options: string[];
    allowMultipleAnswers?: boolean;
  }
) => {
  await ensureChatSchema();
  const hasText = Boolean(content && content.trim().length > 0);
  const hasMedia = Boolean(fileUrl && fileUrl.trim().length > 0);
  const hasPoll = Boolean(pollData && pollData.question && pollData.options && pollData.options.length >= 2);
  if (!hasText && !hasMedia && !hasPoll) {
    throw new ApiError(400, 'Message cannot be empty. Must include text content, an attachment URL, or a poll.');
  }

  const derivedType = hasPoll ? 'poll' : (fileType || deriveFileTypeFromUrl(fileUrl));
  const finalContent = hasPoll && (!content || !content.trim()) ? pollData!.question.trim() : content;
  return await prisma.$transaction(async (tx) => {
    let resolvedConversationId = conversationId;
    let participant = await tx.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId: resolvedConversationId,
          userId: senderId
        }
      }
    });

    if (!participant) {
      const targetUser = await tx.user.findUnique({
        where: { id: conversationId }
      });

      if (targetUser && targetUser.id !== senderId) {
        const sortedIds = [senderId, targetUser.id].sort();
        const directKey = `${sortedIds[0]}_${sortedIds[1]}`;

        let directConv = await tx.conversation.findUnique({
          where: { directKey }
        });

        if (!directConv) {
          try {
            directConv = await tx.conversation.create({
              data: {
                type: 'direct',
                directKey,
                participants: {
                  create: [
                    { userId: senderId },
                    { userId: targetUser.id }
                  ]
                }
              }
            });
          } catch (createErr: any) {
            if (createErr?.code === 'P2002') {
              directConv = await tx.conversation.findUnique({
                where: { directKey }
              });
            } else {
              throw createErr;
            }
          }
        }

        if (directConv) {
          resolvedConversationId = directConv.id;
          participant = await tx.conversationParticipant.findUnique({
            where: {
              conversationId_userId: {
                conversationId: resolvedConversationId,
                userId: senderId
              }
            }
          });
        }
      }
    }

    if (!participant) {
      throw new ApiError(403, 'User is not a participant in this conversation');
    }

    const participants = await tx.conversationParticipant.findMany({
      where: { conversationId: resolvedConversationId },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        }
      }
    });

    const participantUserMap = new Map(participants.map((p) => [p.userId, p.user]));

    let validMentionedUserIds: string[] = [];
    if (Array.isArray(mentions) && mentions.length > 0) {
      validMentionedUserIds = Array.from(
        new Set(
          mentions.filter((id) => typeof id === 'string' && participantUserMap.has(id))
        )
      );
    }

    if (validMentionedUserIds.length === 0 && finalContent) {
      for (const p of participants) {
        if (p.user?.name && finalContent.toLowerCase().includes(`@${p.user.name.toLowerCase()}`)) {
          validMentionedUserIds.push(p.userId);
        }
      }
      validMentionedUserIds = Array.from(new Set(validMentionedUserIds));
    }

    let validatedReplyToId: string | null = null;
    if (replyToId) {
      const replyMsg = await tx.message.findFirst({
        where: { id: replyToId, conversationId: resolvedConversationId },
        select: { id: true }
      });
      if (replyMsg) {
        validatedReplyToId = replyMsg.id;
      }
    }

    if (clientMessageId) {
      const existingMessage = await tx.message.findUnique({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId: resolvedConversationId,
            senderId,
            clientMessageId
          }
        },
        include: messageInclude
      });

      if (existingMessage) {
        const existingMentionedUsers = ((existingMessage as any).mentionedUserIds || [])
          .map((mId: string) => participantUserMap.get(mId))
          .filter(Boolean);

        return {
          message: {
            ...existingMessage,
            reactions: formatReactions((existingMessage as any).reactions || [], senderId),
            poll: formatPoll((existingMessage as any).poll, senderId),
            mentionedUsers: existingMentionedUsers
          },
          participants,
          isDuplicate: true,
          conversationId: resolvedConversationId
        };
      }
    }

    const updatedConversation = await tx.conversation.update({
      where: { id: resolvedConversationId },
      data: {
        updatedAt: new Date(),
        lastSeq: { increment: 1 }
      }
    });

    let message;
    try {
      message = await tx.message.create({
        data: {
          conversationId: resolvedConversationId,
          senderId,
          content: finalContent,
          fileUrl,
          fileType: derivedType,
          fileName: fileName ? fileName.trim() : null,
          fileSize: typeof fileSize === 'number' ? fileSize : null,
          audioDuration: typeof audioDuration === 'number' ? Math.round(audioDuration) : null,
          audioWaveform: Array.isArray(audioWaveform) ? audioWaveform : [],
          clientMessageId,
          seq: updatedConversation.lastSeq,
          mentionedUserIds: validMentionedUserIds,
          replyToId: validatedReplyToId,
          ...(hasPoll ? {
            poll: {
              create: {
                question: pollData!.question.trim(),
                allowMultipleAnswers: Boolean(pollData!.allowMultipleAnswers),
                options: {
                  create: pollData!.options.map((optText, idx) => ({
                    text: optText.trim(),
                    order: idx
                  }))
                }
              }
            }
          } : {})
        },
        include: messageInclude
      });
    } catch (err: any) {
      if (err?.code === 'P2002' && clientMessageId) {
        const existingMessage = await tx.message.findUnique({
          where: {
            conversationId_senderId_clientMessageId: {
              conversationId: resolvedConversationId,
              senderId,
              clientMessageId
            }
          },
          include: messageInclude
        });

        if (existingMessage) {
          const existingMentionedUsers = ((existingMessage as any).mentionedUserIds || [])
            .map((mId: string) => participantUserMap.get(mId))
            .filter(Boolean);

          return {
            message: {
              ...existingMessage,
              reactions: formatReactions((existingMessage as any).reactions || [], senderId),
              poll: formatPoll((existingMessage as any).poll, senderId),
              mentionedUsers: existingMentionedUsers
            },
            participants,
            isDuplicate: true,
            conversationId: resolvedConversationId
          };
        }
      }
      throw err;
    }

    const mentionedUsers = ((message as any).mentionedUserIds || [])
      .map((mId: string) => participantUserMap.get(mId))
      .filter(Boolean);

    return {
      message: {
        ...message,
        reactions: formatReactions((message as any).reactions || [], senderId),
        poll: formatPoll((message as any).poll, senderId),
        mentionedUsers
      },
      participants,
      isDuplicate: false,
      conversationId: resolvedConversationId
    };
  });
};

export const getConversationMessages = async (
  userId: string,
  conversationId: string,
  cursor?: string,
  limit: number = 20
) => {
  await ensureChatSchema();
  let targetConversationId = conversationId;
  const participantExists = await isParticipant(userId, targetConversationId);
  if (!participantExists) {
    const resolvedId = await resolveConversationId(userId, conversationId);
    if (!resolvedId) {
      throw new ApiError(403, 'User is not a participant in this conversation');
    }
    targetConversationId = resolvedId;
  }

  const queryLimit = Math.min(Math.max(limit, 1), 50);

  let cursorSeq: number | null = null;
  if (cursor) {
    const cursorMsg = await prisma.message.findFirst({
      where: { id: cursor, conversationId: targetConversationId },
      select: { seq: true }
    });
    if (!cursorMsg) {
      throw new ApiError(400, 'Invalid cursor for this conversation');
    }
    cursorSeq = cursorMsg.seq;
  }

  const messages = await prisma.message.findMany({
    where: {
      conversationId: targetConversationId,
      NOT: {
        deletedForUserIds: {
          has: userId
        }
      },
      ...(cursorSeq !== null ? { seq: { lt: cursorSeq } } : {})
    },
    take: queryLimit + 1,
    orderBy: [{ seq: 'desc' }, { id: 'desc' }],
    include: messageInclude
  });

  let hasNextPage = false;
  let nextCursor: string | null = null;

  if (messages.length > queryLimit) {
    hasNextPage = true;
    messages.pop();
    nextCursor = messages[messages.length - 1]?.id ?? null;
  }

  const allMentionedIds = Array.from(
    new Set(messages.flatMap((m: any) => m.mentionedUserIds || []))
  );

  let mentionedUserMap = new Map<string, { id: string; name: string | null; avatar: string | null }>();
  if (allMentionedIds.length > 0) {
    const mentionedUsersList = await prisma.user.findMany({
      where: { id: { in: allMentionedIds } },
      select: { id: true, name: true, avatar: true }
    });
    mentionedUserMap = new Map(mentionedUsersList.map((u) => [u.id, u]));
  }

  const enrichedMessages = messages.map((msg: any) => ({
    ...msg,
    reactions: formatReactions(msg.reactions || [], userId),
    poll: formatPoll(msg.poll, userId),
    mentionedUsers: (msg.mentionedUserIds || [])
      .map((mId: string) => mentionedUserMap.get(mId))
      .filter(Boolean)
  }));

  return {
    messages: enrichedMessages,
    nextCursor,
    hasNextPage
  };
};

export const getUserConversations = async (userId: string, query?: string) => {
  await ensureChatSchema();
  const trimmed = typeof query === 'string' ? query.trim() : '';

  const whereClause: any = {
    participants: {
      some: { userId }
    }
  };

  if (trimmed) {
    whereClause.OR = [
      {
        name: {
          contains: trimmed,
          mode: 'insensitive'
        }
      },
      {
        participants: {
          some: {
            userId: { not: userId },
            user: {
              OR: [
                { name: { contains: trimmed, mode: 'insensitive' } },
                { email: { contains: trimmed, mode: 'insensitive' } }
              ]
            }
          }
        }
      },
      {
        messages: {
          some: {
            content: {
              contains: trimmed,
              mode: 'insensitive'
            },
            NOT: {
              deletedForUserIds: {
                has: userId
              }
            }
          }
        }
      }
    ];
  }

  const conversations = await prisma.conversation.findMany({
    where: whereClause,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true
            }
          }
        }
      },
      messages: {
        where: {
          NOT: {
            deletedForUserIds: {
              has: userId
            }
          }
        },
        take: 1,
        orderBy: [{ seq: 'desc' }, { id: 'desc' }],
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              avatar: true
            }
          },
          poll: {
            select: {
              id: true,
              question: true
            }
          }
        }
      }
    }
  });

  if (conversations.length === 0) {
    return [];
  }

  const unreadMap = new Map<string, number>();
  try {
    const unreadCounts = await prisma.$queryRaw<Array<{ conversationId: string; unreadCount: number }>>`
      SELECT 
        cp."conversationId",
        COUNT(m.id)::int AS "unreadCount"
      FROM "ConversationParticipant" cp
      LEFT JOIN "Message" m ON m."conversationId" = cp."conversationId"
        AND m."senderId" != cp."userId"
        AND m."seq" > cp."lastReadSeq"
        AND NOT (${userId} = ANY(COALESCE(m."deletedForUserIds", ARRAY[]::TEXT[])))
      WHERE cp."userId" = ${userId}
      GROUP BY cp."conversationId"
    `;

    for (const row of unreadCounts) {
      unreadMap.set(row.conversationId, Number(row.unreadCount));
    }
  } catch (rawErr: any) {
    logger.warn('Failed to calculate unread counts with raw query:', rawErr);
  }

  return conversations.map((conv) => ({
    ...conv,
    lastMessage: conv.messages[0] || null,
    unreadCount: unreadMap.get(conv.id) || 0
  }));
};

export const markMessageAsRead = async (
  userId: string,
  conversationId: string,
  messageId: string
) => {
  return await prisma.$transaction(async (tx) => {
    let targetConversationId = conversationId;
    let participant = await tx.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId: targetConversationId,
          userId
        }
      }
    });

    if (!participant) {
      const targetUser = await tx.user.findUnique({
        where: { id: conversationId }
      });
      if (targetUser && targetUser.id !== userId) {
        const sortedIds = [userId, targetUser.id].sort();
        const directKey = `${sortedIds[0]}_${sortedIds[1]}`;
        const directConv = await tx.conversation.findUnique({
          where: { directKey }
        });
        if (directConv) {
          targetConversationId = directConv.id;
          participant = await tx.conversationParticipant.findUnique({
            where: {
              conversationId_userId: {
                conversationId: targetConversationId,
                userId
              }
            }
          });
        }
      }
    }

    if (!participant) {
      throw new ApiError(403, 'User is not a participant in this conversation');
    }

    const targetMessage = await tx.message.findFirst({
      where: {
        id: messageId,
        conversationId: targetConversationId
      }
    });

    if (!targetMessage) {
      throw new ApiError(404, 'Message not found in this conversation');
    }

    const updateResult = await tx.conversationParticipant.updateMany({
      where: {
        conversationId: targetConversationId,
        userId,
        lastReadSeq: { lt: targetMessage.seq }
      },
      data: {
        lastReadMessageId: messageId,
        lastReadSeq: targetMessage.seq
      }
    });

    const isUpdated = updateResult.count > 0;

    const currentParticipant = isUpdated
      ? { lastReadSeq: targetMessage.seq, lastReadMessageId: messageId }
      : (await tx.conversationParticipant.findUnique({
          where: {
            conversationId_userId: {
              conversationId: targetConversationId,
              userId
            }
          }
        })) || participant;

    const participants = await tx.conversationParticipant.findMany({
      where: { conversationId: targetConversationId },
      select: { userId: true }
    });

    return {
      conversationId: targetConversationId,
      userId,
      lastReadSeq: currentParticipant.lastReadSeq,
      lastReadMessageId: currentParticipant.lastReadMessageId || messageId,
      messageId: currentParticipant.lastReadMessageId || messageId,
      updated: isUpdated,
      participants
    };
  });
};

export const searchConversationMessages = async (
  userId: string,
  conversationId: string,
  query: string,
  cursor?: string,
  limit: number = 20
) => {
  let targetConversationId = conversationId;
  const participantExists = await isParticipant(userId, targetConversationId);
  if (!participantExists) {
    const resolvedId = await resolveConversationId(userId, conversationId);
    if (!resolvedId) {
      throw new ApiError(403, 'User is not a participant in this conversation');
    }
    targetConversationId = resolvedId;
  }

  const sanitizedQuery = query ? query.trim() : '';
  if (!sanitizedQuery) {
    return { messages: [], nextCursor: null, hasNextPage: false };
  }

  const queryLimit = Math.min(Math.max(limit, 1), 50);

  let cursorSeq: number | null = null;
  if (cursor) {
    const cursorMsg = await prisma.message.findFirst({
      where: { id: cursor, conversationId: targetConversationId },
      select: { seq: true }
    });
    if (!cursorMsg) {
      throw new ApiError(400, 'Invalid cursor for this conversation');
    }
    cursorSeq = cursorMsg.seq;
  }

  const whereClause = {
    conversationId: targetConversationId,
    OR: [
      {
        content: {
          contains: sanitizedQuery,
          mode: 'insensitive' as const
        }
      },
      {
        poll: {
          OR: [
            {
              question: {
                contains: sanitizedQuery,
                mode: 'insensitive' as const
              }
            },
            {
              options: {
                some: {
                  text: {
                    contains: sanitizedQuery,
                    mode: 'insensitive' as const
                  }
                }
              }
            }
          ]
        }
      }
    ],
    NOT: {
      deletedForUserIds: {
        has: userId
      }
    },
    ...(cursorSeq !== null ? { seq: { lt: cursorSeq } } : {})
  };

  const messages = await prisma.message.findMany({
    where: whereClause,
    orderBy: [{ seq: 'desc' }, { id: 'desc' }],
    take: queryLimit + 1,
    include: messageInclude
  });

  let hasNextPage = false;
  let nextCursor: string | null = null;

  if (messages.length > queryLimit) {
    hasNextPage = true;
    messages.pop();
    nextCursor = messages[messages.length - 1]?.id ?? null;
  }

  const enrichedMessages = messages.map((msg: any) => ({
    ...msg,
    reactions: formatReactions((msg as any).reactions || [], userId),
    poll: formatPoll((msg as any).poll, userId)
  }));

  return {
    messages: enrichedMessages,
    nextCursor,
    hasNextPage
  };
};

export const createGroupConversation = async (
  creatorId: string,
  name: string,
  participantIds: string[],
  avatar?: string
) => {
  const uniqueUserIds = Array.from(new Set([creatorId, ...participantIds]));

  const conversation = await prisma.$transaction(async (tx) => {
    const existingUsers = await tx.user.findMany({
      where: { id: { in: uniqueUserIds } },
      select: { id: true }
    });

    if (existingUsers.length !== uniqueUserIds.length) {
      throw new ApiError(400, 'One or more participant user IDs are invalid');
    }

    return await tx.conversation.create({
      data: {
        type: 'group',
        name: name.trim(),
        avatar: avatar || null,
        participants: {
          create: uniqueUserIds.map((userId) => ({
            userId,
            role: userId === creatorId ? 'admin' : 'member'
          }))
        }
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true
              }
            }
          }
        },
        messages: {
          take: 1,
          orderBy: [{ seq: 'desc' }, { id: 'desc' }]
        }
      }
    });
  });

  notifyConversationUpdate(uniqueUserIds, conversation);

  return conversation;
};

export const addGroupParticipants = async (
  userId: string,
  conversationId: string,
  participantIds: string[]
) => {
  const { updated, allParticipantIds } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;

    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: true
      }
    });

    if (!conversation) {
      throw new ApiError(404, 'Conversation not found');
    }

    if (conversation.type !== 'group') {
      throw new ApiError(400, 'Cannot add participants to a direct conversation');
    }

    const userParticipant = conversation.participants.find((p: any) => p.userId === userId);
    if (!userParticipant) {
      throw new ApiError(403, 'You are not a member of this conversation');
    }

    if (userParticipant.role !== 'admin') {
      throw new ApiError(403, 'Only group admins can add participants to this group');
    }

    const existingParticipantIds = new Set(conversation.participants.map((p: any) => p.userId));
    const newParticipantIds = Array.from(new Set(participantIds)).filter((id) => !existingParticipantIds.has(id));

    if (newParticipantIds.length === 0) {
      throw new ApiError(400, 'All specified users are already participants in this group');
    }

    const existingUsers = await tx.user.findMany({
      where: { id: { in: newParticipantIds } },
      select: { id: true }
    });

    if (existingUsers.length !== newParticipantIds.length) {
      throw new ApiError(400, 'One or more specified participant user IDs do not exist');
    }

    await tx.conversationParticipant.createMany({
      data: newParticipantIds.map((pId) => ({
        conversationId,
        userId: pId,
        role: 'member'
      })),
      skipDuplicates: true
    });

    const updatedConv = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date()
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true
              }
            }
          }
        },
        messages: {
          take: 1,
          orderBy: [{ seq: 'desc' }, { id: 'desc' }]
        }
      }
    });

    const allParticipantIds = updatedConv.participants.map((p) => p.userId);
    return { updated: updatedConv, allParticipantIds };
  });

  notifyConversationUpdate(allParticipantIds, updated);

  return updated;
};

export const removeGroupParticipant = async (
  userId: string,
  conversationId: string,
  targetUserId: string
) => {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;

    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: true
      }
    });

    if (!conversation) {
      throw new ApiError(404, 'Conversation not found');
    }

    if (conversation.type !== 'group') {
      throw new ApiError(400, 'Cannot remove participants from a direct conversation');
    }

    const userParticipant = conversation.participants.find((p: any) => p.userId === userId);
    if (!userParticipant) {
      throw new ApiError(403, 'You are not a member of this conversation');
    }

    const targetParticipant = conversation.participants.find((p: any) => p.userId === targetUserId);
    if (!targetParticipant) {
      throw new ApiError(404, 'Target user is not a participant in this conversation');
    }

    const isSelfRemoval = userId === targetUserId;

    if (!isSelfRemoval) {
      if (userParticipant.role !== 'admin') {
        throw new ApiError(403, 'Only group admins can remove participants');
      }

      if (targetParticipant.role === 'admin') {
        const remainingAdmins = conversation.participants.filter(
          (p: any) => p.userId !== targetUserId && p.role === 'admin'
        );
        if (remainingAdmins.length === 0) {
          throw new ApiError(400, 'Cannot remove the last admin of the group');
        }
      }
    }

    const remainingParticipants = conversation.participants.filter((p: any) => p.userId !== targetUserId);

    if (isSelfRemoval && userParticipant.role === 'admin' && remainingParticipants.length > 0) {
      const remainingAdmins = remainingParticipants.filter((p: any) => p.role === 'admin');
      if (remainingAdmins.length === 0) {
        const sorted = [...remainingParticipants].sort(
          (a: any, b: any) => new Date(a.joinedAt || 0).getTime() - new Date(b.joinedAt || 0).getTime()
        );
        const nextAdmin = sorted[0];
        if (nextAdmin) {
          await tx.conversationParticipant.update({
            where: { id: nextAdmin.id },
            data: { role: 'admin' }
          });
          nextAdmin.role = 'admin';
        }
      }
    }

    await tx.conversationParticipant.delete({
      where: {
        conversationId_userId: {
          conversationId,
          userId: targetUserId
        }
      }
    });

    const finalRemaining = await tx.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true }
    });

    if (finalRemaining.length === 0) {
      await tx.conversation.delete({
        where: { id: conversationId }
      });
      return { conversationDeleted: true, remainingUserIds: [] };
    }

    const updatedConv = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date()
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true
              }
            }
          }
        },
        messages: {
          take: 1,
          orderBy: [{ seq: 'desc' }, { id: 'desc' }]
        }
      }
    });

    return {
      conversationDeleted: false,
      updated: updatedConv,
      remainingUserIds: finalRemaining.map((p: any) => p.userId)
    };
  });

  safeEjectUserFromRoom(conversationId, targetUserId, userId);

  if (!result.conversationDeleted && result.updated) {
    notifyConversationUpdate(result.remainingUserIds, result.updated);
  }

  return { success: true, conversationDeleted: result.conversationDeleted };
};

export const updateGroupConversation = async (
  userId: string,
  conversationId: string,
  updates: { name?: string; avatar?: string | null }
) => {
  const { updated, allParticipantIds } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;

    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: true
      }
    });

    if (!conversation) {
      throw new ApiError(404, 'Conversation not found');
    }

    if (conversation.type !== 'group') {
      throw new ApiError(400, 'Cannot modify direct conversation details');
    }

    const userParticipant = conversation.participants.find((p: any) => p.userId === userId);
    if (!userParticipant) {
      throw new ApiError(403, 'You are not a member of this conversation');
    }

    if (userParticipant.role !== 'admin') {
      throw new ApiError(403, 'Only group admins can update group details');
    }

    const dataToUpdate: any = {};
    if (updates.name !== undefined) {
      dataToUpdate.name = updates.name.trim();
    }
    if (updates.avatar !== undefined) {
      dataToUpdate.avatar = updates.avatar;
    }
    dataToUpdate.updatedAt = new Date();

    const updatedConv = await tx.conversation.update({
      where: { id: conversationId },
      data: dataToUpdate,
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true
              }
            }
          }
        },
        messages: {
          take: 1,
          orderBy: [{ seq: 'desc' }, { id: 'desc' }]
        }
      }
    });

    const allParticipantIds = updatedConv.participants.map((p) => p.userId);
    return { updated: updatedConv, allParticipantIds };
  });

  notifyConversationUpdate(allParticipantIds, updated);

  return updated;
};

export const makeGroupAdmin = async (
  userId: string,
  conversationId: string,
  targetUserId: string
) => {
  const { updated, allParticipantIds } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;

    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: true
      }
    });

    if (!conversation) {
      throw new ApiError(404, 'Conversation not found');
    }

    if (conversation.type !== 'group') {
      throw new ApiError(400, 'Cannot manage admins in a direct conversation');
    }

    const requester = conversation.participants.find((p: any) => p.userId === userId);
    if (!requester) {
      throw new ApiError(403, 'You are not a member of this conversation');
    }

    if (requester.role !== 'admin') {
      throw new ApiError(403, 'Only group admins can promote members to admin');
    }

    const target = conversation.participants.find((p: any) => p.userId === targetUserId);
    if (!target) {
      throw new ApiError(404, 'Target user is not a participant in this group');
    }

    if (target.role !== 'admin') {
      await tx.conversationParticipant.update({
        where: { id: target.id },
        data: { role: 'admin' }
      });
    }

    const updatedConv = await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true
              }
            }
          }
        },
        messages: {
          take: 1,
          orderBy: [{ seq: 'desc' }, { id: 'desc' }]
        }
      }
    });

    const allParticipantIds = updatedConv.participants.map((p) => p.userId);
    return { updated: updatedConv, allParticipantIds };
  });

  notifyConversationUpdate(allParticipantIds, updated);
  return updated;
};

export const dismissGroupAdmin = async (
  userId: string,
  conversationId: string,
  targetUserId: string
) => {
  const { updated, allParticipantIds } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;

    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: true
      }
    });

    if (!conversation) {
      throw new ApiError(404, 'Conversation not found');
    }

    if (conversation.type !== 'group') {
      throw new ApiError(400, 'Cannot manage admins in a direct conversation');
    }

    const requester = conversation.participants.find((p: any) => p.userId === userId);
    if (!requester) {
      throw new ApiError(403, 'You are not a member of this conversation');
    }

    if (requester.role !== 'admin') {
      throw new ApiError(403, 'Only group admins can remove admin privileges');
    }

    if (targetUserId === userId) {
      throw new ApiError(400, 'Admins cannot demote themselves directly. Use Leave Group to leave.');
    }

    const target = conversation.participants.find((p: any) => p.userId === targetUserId);
    if (!target) {
      throw new ApiError(404, 'Target user is not a participant in this group');
    }

    if (target.role !== 'admin') {
      throw new ApiError(400, 'User is not an admin');
    }

    const remainingAdmins = conversation.participants.filter(
      (p: any) => p.userId !== targetUserId && p.role === 'admin'
    );
    if (remainingAdmins.length === 0) {
      throw new ApiError(400, 'Cannot demote the last admin of the group');
    }

    await tx.conversationParticipant.update({
      where: { id: target.id },
      data: { role: 'member' }
    });

    const updatedConv = await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true
              }
            }
          }
        },
        messages: {
          take: 1,
          orderBy: [{ seq: 'desc' }, { id: 'desc' }]
        }
      }
    });

    const allParticipantIds = updatedConv.participants.map((p) => p.userId);
    return { updated: updatedConv, allParticipantIds };
  });

  notifyConversationUpdate(allParticipantIds, updated);
  return updated;
};

export const editMessage = async (
  userId: string,
  conversationIdOrTarget: string,
  messageId: string,
  newContent: string
) => {
  if (!newContent || !newContent.trim()) {
    throw new ApiError(400, 'Message content cannot be empty');
  }

  const resolvedConversationId = await resolveConversationId(userId, conversationIdOrTarget);
  if (!resolvedConversationId) {
    throw new ApiError(404, 'Conversation not found or you are not a participant');
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: messageInclude
  });

  if (!message || message.conversationId !== resolvedConversationId) {
    throw new ApiError(404, 'Message not found');
  }

  if (message.senderId !== userId) {
    throw new ApiError(403, 'You can only edit your own messages');
  }

  if (message.isDeleted) {
    throw new ApiError(400, 'Cannot edit a deleted message');
  }

  const updatedMessage = await prisma.message.update({
    where: { id: messageId },
    data: {
      content: newContent.trim(),
      isEdited: true,
      editedAt: new Date(),
      updatedAt: new Date()
    },
    include: messageInclude
  });

  const mentionedUserIds = (updatedMessage as any).mentionedUserIds || [];
  let mentionedUsers: any[] = [];
  if (mentionedUserIds.length > 0) {
    mentionedUsers = await prisma.user.findMany({
      where: { id: { in: mentionedUserIds } },
      select: { id: true, name: true, avatar: true }
    });
  }

  const enrichedMessage = {
    ...updatedMessage,
    reactions: formatReactions((updatedMessage as any).reactions || [], userId),
    poll: formatPoll((updatedMessage as any).poll, userId),
    mentionedUsers
  };

  try {
    const io = getIO();
    const rooms = [`conversation:${resolvedConversationId}`];
    if (conversationIdOrTarget !== resolvedConversationId) {
      rooms.push(`conversation:${conversationIdOrTarget}`);
    }
    io.to(rooms).emit(CHAT_EVENTS.MESSAGE_UPDATED, enrichedMessage);

    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId: resolvedConversationId },
      select: { userId: true }
    });

    const latestMessage = await prisma.message.findFirst({
      where: { conversationId: resolvedConversationId },
      orderBy: [{ seq: 'desc' }, { id: 'desc' }]
    });

    if (latestMessage && latestMessage.id === messageId) {
      participants.forEach((p) => {
        io.to(`user:${p.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
          conversationId: resolvedConversationId,
          lastMessage: enrichedMessage
        });
      });
    }
  } catch (err: any) {
    logger.error('Failed to emit message:updated event', { messageId, error: err.message });
  }

  return enrichedMessage;
};

export const deleteMessage = async (
  userId: string,
  conversationIdOrTarget: string,
  messageId: string,
  deleteForEveryone: boolean = true
) => {
  const resolvedConversationId = await resolveConversationId(userId, conversationIdOrTarget);
  if (!resolvedConversationId) {
    throw new ApiError(404, 'Conversation not found or you are not a participant');
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      conversation: {
        include: {
          participants: true
        }
      }
    }
  });

  if (!message || message.conversationId !== resolvedConversationId) {
    throw new ApiError(404, 'Message not found');
  }

  const participant = message.conversation.participants.find((p) => p.userId === userId);
  if (!participant) {
    throw new ApiError(403, 'You are not a participant in this conversation');
  }

  const isSender = message.senderId === userId;
  const isGroupAdmin =
    message.conversation.ownerId === userId ||
    participant.role === 'admin' ||
    participant.role === 'owner';

  if (deleteForEveryone) {
    if (!isSender && !isGroupAdmin) {
      throw new ApiError(403, 'You do not have permission to delete this message for everyone');
    }
  }

  let deletedPayload: any;
  if (deleteForEveryone) {
    deletedPayload = await prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        content: 'This message was deleted',
        fileUrl: null,
        fileType: null,
        fileName: null,
        fileSize: null,
        audioDuration: null,
        audioWaveform: []
      },
      include: messageInclude
    });
    await prisma.poll.deleteMany({
      where: { messageId }
    });
  } else {
    const alreadyDeleted = (message as any).deletedForUserIds?.includes(userId);
    if (!alreadyDeleted) {
      deletedPayload = await prisma.message.update({
        where: { id: messageId },
        data: {
          deletedForUserIds: {
            push: userId
          }
        },
        include: messageInclude
      });
    } else {
      deletedPayload = message;
    }
  }

  const lastMessage = await prisma.message.findFirst({
    where: {
      conversationId: resolvedConversationId,
      NOT: {
        deletedForUserIds: {
          has: userId
        }
      }
    },
    orderBy: [{ seq: 'desc' }, { id: 'desc' }],
    include: messageInclude
  });

  try {
    const io = getIO();
    if (deleteForEveryone) {
      const rooms = [`conversation:${resolvedConversationId}`];
      if (conversationIdOrTarget !== resolvedConversationId) {
        rooms.push(`conversation:${conversationIdOrTarget}`);
      }
      io.to(rooms).emit(CHAT_EVENTS.MESSAGE_DELETED, {
        conversationId: resolvedConversationId,
        messageId,
        isDeleted: true,
        deleteForEveryone: true,
        message: deletedPayload ? {
          ...deletedPayload,
          reactions: formatReactions((deletedPayload as any).reactions || []),
          poll: null,
          mentionedUsers: []
        } : null
      });

      message.conversation.participants.forEach((p) => {
        io.to(`user:${p.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
          conversationId: resolvedConversationId,
          lastMessage: lastMessage ? {
            ...lastMessage,
            reactions: formatReactions((lastMessage as any).reactions || []),
            poll: formatPoll((lastMessage as any).poll, p.userId),
            mentionedUsers: []
          } : null
        });
      });
    } else {
      io.to(`user:${userId}`).emit(CHAT_EVENTS.MESSAGE_DELETED, {
        conversationId: resolvedConversationId,
        messageId,
        isDeleted: true,
        deleteForEveryone: false,
        deletedForMe: true
      });

      io.to(`user:${userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
        conversationId: resolvedConversationId,
        lastMessage: lastMessage ? {
          ...lastMessage,
          reactions: formatReactions((lastMessage as any).reactions || []),
          poll: formatPoll((lastMessage as any).poll, userId),
          mentionedUsers: []
        } : null
      });
    }
  } catch (err: any) {
    logger.error('Failed to emit message:deleted event', { messageId, error: err.message });
  }

  return {
    success: true,
    messageId,
    conversationId: resolvedConversationId,
    isDeleted: true,
    deleteForEveryone
  };
};

export const toggleMessageReaction = async (
  userId: string,
  conversationIdOrTarget: string,
  messageId: string,
  emoji: string
) => {
  if (!emoji || !emoji.trim()) {
    throw new ApiError(400, 'Emoji is required');
  }

  const resolvedConversationId = await resolveConversationId(userId, conversationIdOrTarget);
  if (!resolvedConversationId) {
    throw new ApiError(404, 'Conversation not found or you are not a participant');
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId }
  });

  if (!message || message.conversationId !== resolvedConversationId) {
    throw new ApiError(404, 'Message not found');
  }

  if (message.isDeleted) {
    throw new ApiError(400, 'Cannot react to a deleted message');
  }

  const trimmedEmoji = emoji.trim();

  const existingReaction = await prisma.messageReaction.findUnique({
    where: {
      messageId_userId_emoji: {
        messageId,
        userId,
        emoji: trimmedEmoji
      }
    }
  });

  let action: 'added' | 'removed';
  if (existingReaction) {
    try {
      await prisma.messageReaction.delete({
        where: { id: existingReaction.id }
      });
      action = 'removed';
    } catch (delErr: any) {
      if (delErr?.code === 'P2025') {
        action = 'removed';
      } else {
        throw delErr;
      }
    }
  } else {
    try {
      await prisma.messageReaction.create({
        data: {
          messageId,
          userId,
          emoji: trimmedEmoji
        }
      });
      action = 'added';
    } catch (createErr: any) {
      if (createErr?.code === 'P2002') {
        await prisma.messageReaction.deleteMany({
          where: {
            messageId,
            userId,
            emoji: trimmedEmoji
          }
        });
        action = 'removed';
      } else {
        throw createErr;
      }
    }
  }

  const allReactions = await prisma.messageReaction.findMany({
    where: { messageId },
    select: {
      id: true,
      emoji: true,
      userId: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  });

  const formatted = formatReactions(allReactions, userId);

  try {
    const io = getIO();
    const rooms = [`conversation:${resolvedConversationId}`];
    if (conversationIdOrTarget !== resolvedConversationId) {
      rooms.push(`conversation:${conversationIdOrTarget}`);
    }
    io.to(rooms).emit(CHAT_EVENTS.MESSAGE_REACTION_UPDATED, {
      conversationId: resolvedConversationId,
      messageId,
      emoji: trimmedEmoji,
      userId,
      action,
      reactions: formatted
    });
  } catch (err: any) {
    logger.error('Failed to emit message:reaction_updated event', { messageId, error: err.message });
  }

  return {
    success: true,
    messageId,
    conversationId: resolvedConversationId,
    emoji: trimmedEmoji,
    userId,
    action,
    reactions: formatted
  };
};

export const getMessageReactions = async (
  userId: string,
  conversationIdOrTarget: string,
  messageId: string,
  emojiFilter?: string
) => {
  const resolvedConversationId = await resolveConversationId(userId, conversationIdOrTarget);
  if (!resolvedConversationId) {
    throw new ApiError(404, 'Conversation not found or you are not a participant');
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, isDeleted: true }
  });

  if (!message || message.conversationId !== resolvedConversationId) {
    throw new ApiError(404, 'Message not found in this conversation');
  }

  if (message.isDeleted) {
    throw new ApiError(400, 'Cannot view reactions for a deleted message');
  }

  const allReactions = await prisma.messageReaction.findMany({
    where: {
      messageId,
      ...(emojiFilter && { emoji: emojiFilter.trim() })
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      emoji: true,
      userId: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  });

  const allReactionsForSummary = emojiFilter
    ? await prisma.messageReaction.findMany({
        where: { messageId },
        select: {
          emoji: true,
          userId: true
        }
      })
    : allReactions;

  const summary = formatReactions(allReactionsForSummary, userId);
  const totalCount = allReactionsForSummary.length;

  const reactionList = allReactions.map((r) => ({
    id: r.id,
    emoji: r.emoji,
    userId: r.userId,
    createdAt: r.createdAt,
    isMe: r.userId === userId,
    user: {
      id: r.user?.id || r.userId,
      name: r.user?.name || 'User',
      avatar: r.user?.avatar || null
    }
  }));

  return {
    messageId,
    conversationId: resolvedConversationId,
    totalCount,
    summary,
    reactions: reactionList
  };
};

export const forwardMessages = async (
  userId: string,
  messageIds: string[],
  targetConversationIds: string[]
) => {
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    throw new ApiError(400, 'messageIds must be a non-empty array');
  }
  if (!Array.isArray(targetConversationIds) || targetConversationIds.length === 0) {
    throw new ApiError(400, 'targetConversationIds must be a non-empty array');
  }

  const sourceMessages = await prisma.message.findMany({
    where: { id: { in: messageIds } },
    include: {
      conversation: {
        include: { participants: true }
      },
      poll: {
        include: {
          options: {
            orderBy: { order: 'asc' as const }
          }
        }
      }
    }
  });

  const sourceMap = new Map(sourceMessages.map((m) => [m.id, m]));
  const orderedSourceMessages = messageIds
    .map((id) => sourceMap.get(id))
    .filter((m): m is (typeof sourceMessages)[0] => Boolean(m));

  if (orderedSourceMessages.length === 0) {
    throw new ApiError(404, 'No valid messages found to forward');
  }

  for (const srcMsg of orderedSourceMessages) {
    const isSourceParticipant = srcMsg.conversation.participants.some((p) => p.userId === userId);
    if (!isSourceParticipant || srcMsg.deletedForUserIds?.includes(userId)) {
      throw new ApiError(403, 'You do not have access to one or more source messages');
    }
  }

  const forwardedResults: any[] = [];
  const io = getIO();

  for (const targetId of targetConversationIds) {
    const resolvedTargetId = await resolveConversationId(userId, targetId);
    if (!resolvedTargetId) {
      continue;
    }

    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId: resolvedTargetId },
      include: {
        user: {
          select: { id: true, name: true, avatar: true }
        }
      }
    });

    for (const srcMsg of orderedSourceMessages) {
      if (srcMsg.isDeleted || srcMsg.deletedForUserIds?.includes(userId)) {
        continue;
      }

      const updatedConv = await prisma.conversation.update({
        where: { id: resolvedTargetId },
        data: {
          updatedAt: new Date(),
          lastSeq: { increment: 1 }
        }
      });

      const forwardedMsg = await prisma.message.create({
        data: {
          conversationId: resolvedTargetId,
          senderId: userId,
          content: srcMsg.content,
          fileUrl: srcMsg.fileUrl,
          fileType: srcMsg.fileType,
          fileName: srcMsg.fileName,
          fileSize: srcMsg.fileSize,
          audioDuration: srcMsg.audioDuration,
          audioWaveform: srcMsg.audioWaveform || [],
          isForwarded: true,
          forwardCount: (srcMsg.forwardCount || 0) + 1,
          seq: updatedConv.lastSeq,
          ...(srcMsg.poll ? {
            poll: {
              create: {
                question: srcMsg.poll.question,
                allowMultipleAnswers: srcMsg.poll.allowMultipleAnswers,
                options: {
                  create: srcMsg.poll.options.map((opt: any) => ({
                    text: opt.text,
                    order: opt.order
                  }))
                }
              }
            }
          } : {})
        },
        include: messageInclude
      });

      const enriched = {
        ...forwardedMsg,
        reactions: [],
        poll: formatPoll((forwardedMsg as any).poll, userId),
        mentionedUsers: []
      };

      forwardedResults.push(enriched);

      try {
        const rooms = [`conversation:${resolvedTargetId}`];
        if (targetId !== resolvedTargetId) {
          rooms.push(`conversation:${targetId}`);
        }
        io.to(rooms).emit(CHAT_EVENTS.MESSAGE_NEW, enriched);

        participants.forEach((p) => {
          io.to(`user:${p.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
            conversationId: resolvedTargetId,
            lastMessage: enriched
          });
        });
      } catch (err: any) {
        logger.error('Failed to emit message:new for forwarded message', { error: err.message });
      }
    }
  }

  return forwardedResults;
};

export const votePoll = async (
  userId: string,
  conversationIdOrTarget: string,
  pollIdOrMessageId: string,
  optionIds: string[]
) => {
  if (!Array.isArray(optionIds) || optionIds.length === 0) {
    throw new ApiError(400, 'optionIds must be a non-empty array of option IDs');
  }

  const resolvedConversationId = await resolveConversationId(userId, conversationIdOrTarget);
  if (!resolvedConversationId) {
    throw new ApiError(404, 'Conversation not found or you are not a participant');
  }

  const poll = await prisma.poll.findFirst({
    where: {
      OR: [
        { id: pollIdOrMessageId },
        { messageId: pollIdOrMessageId }
      ]
    },
    include: {
      message: {
        select: {
          id: true,
          conversationId: true,
          isDeleted: true
        }
      },
      options: {
        orderBy: { order: 'asc' as const }
      }
    }
  });

  if (!poll || poll.message.conversationId !== resolvedConversationId) {
    throw new ApiError(404, 'Poll not found in this conversation');
  }

  if (poll.message.isDeleted) {
    throw new ApiError(400, 'Cannot vote on a deleted message poll');
  }

  const validOptionIdSet = new Set(poll.options.map((o) => o.id));
  for (const optId of optionIds) {
    if (!validOptionIdSet.has(optId)) {
      throw new ApiError(400, `Invalid option ID: ${optId}`);
    }
  }

  if (!poll.allowMultipleAnswers && optionIds.length > 1) {
    throw new ApiError(400, 'This poll only allows single choice voting');
  }

  await prisma.$transaction(async (tx) => {
    if (!poll.allowMultipleAnswers) {
      const selectedOptionId = optionIds[0];
      const existingVote = await tx.pollVote.findFirst({
        where: {
          userId,
          option: {
            pollId: poll.id
          }
        }
      });

      if (existingVote && existingVote.pollOptionId === selectedOptionId) {
        await tx.pollVote.delete({
          where: { id: existingVote.id }
        });
      } else {
        if (existingVote) {
          await tx.pollVote.delete({
            where: { id: existingVote.id }
          });
        }
        await tx.pollVote.create({
          data: {
            pollOptionId: selectedOptionId,
            userId
          }
        });
      }
    } else {
      for (const targetOptionId of optionIds) {
        const existingVote = await tx.pollVote.findUnique({
          where: {
            pollOptionId_userId: {
              pollOptionId: targetOptionId,
              userId
            }
          }
        });

        if (existingVote) {
          await tx.pollVote.delete({
            where: { id: existingVote.id }
          });
        } else {
          await tx.pollVote.create({
            data: {
              pollOptionId: targetOptionId,
              userId
            }
          });
        }
      }
    }
  });

  const updatedPoll = await prisma.poll.findUnique({
    where: { id: poll.id },
    include: {
      options: {
        orderBy: { order: 'asc' as const },
        include: {
          votes: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatar: true
                }
              }
            }
          }
        }
      }
    }
  });

  const formattedForRequester = formatPoll(updatedPoll, userId);
  const formattedPublic = formatPoll(updatedPoll);

  try {
    const io = getIO();
    const rooms = [`conversation:${resolvedConversationId}`];
    if (conversationIdOrTarget !== resolvedConversationId) {
      rooms.push(`conversation:${conversationIdOrTarget}`);
    }
    io.to(rooms).emit(CHAT_EVENTS.POLL_UPDATED, {
      conversationId: resolvedConversationId,
      messageId: poll.message.id,
      pollId: poll.id,
      poll: formattedPublic
    });
  } catch (err: any) {
    logger.error('Failed to emit poll:updated event', { pollId: poll.id, error: err.message });
  }

  return {
    success: true,
    conversationId: resolvedConversationId,
    messageId: poll.message.id,
    pollId: poll.id,
    poll: formattedForRequester
  };
};









