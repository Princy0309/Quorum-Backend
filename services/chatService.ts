import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';

export const getOrCreateDirectConversation = async (userId: string, targetUserId: string) => {
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

export const saveMessage = async (
  senderId: string,
  conversationId: string,
  content: string,
  fileUrl?: string,
  fileType?: string,
  clientMessageId?: string
) => {
  const derivedType = deriveFileTypeFromUrl(fileUrl);
  return await prisma.$transaction(async (tx) => {
    const participant = await tx.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId: senderId
        }
      }
    });

    if (!participant) {
      throw new ApiError(403, 'User is not a participant in this conversation');
    }

    if (clientMessageId) {
      const existingMessage = await tx.message.findUnique({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId,
            senderId,
            clientMessageId
          }
        },
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              avatar: true
            }
          }
        }
      });

      if (existingMessage) {
        const participants = await tx.conversationParticipant.findMany({
          where: { conversationId },
          select: { userId: true }
        });
        return { message: existingMessage, participants, isDuplicate: true };
      }
    }

    const updatedConversation = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        lastSeq: { increment: 1 }
      }
    });

    let message;
    try {
      message = await tx.message.create({
        data: {
          conversationId,
          senderId,
          content,
          fileUrl,
          fileType: derivedType,
          clientMessageId,
          seq: updatedConversation.lastSeq
        },
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              avatar: true
            }
          }
        }
      });
    } catch (err: any) {
      if (err?.code === 'P2002' && clientMessageId) {
        const existingMessage = await tx.message.findUnique({
          where: {
            conversationId_senderId_clientMessageId: {
              conversationId,
              senderId,
              clientMessageId
            }
          },
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                avatar: true
              }
            }
          }
        });

        if (existingMessage) {
          const participants = await tx.conversationParticipant.findMany({
            where: { conversationId },
            select: { userId: true }
          });
          return { message: existingMessage, participants, isDuplicate: true };
        }
      }
      throw err;
    }

    const participants = await tx.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true }
    });

    return { message, participants, isDuplicate: false };
  });
};

export const getConversationMessages = async (
  userId: string,
  conversationId: string,
  cursor?: string,
  limit: number = 20
) => {
  const participantExists = await isParticipant(userId, conversationId);
  if (!participantExists) {
    throw new ApiError(403, 'User is not a participant in this conversation');
  }

  const queryLimit = Math.min(Math.max(limit, 1), 50);

  let cursorSeq: number | null = null;
  if (cursor) {
    const cursorMsg = await prisma.message.findFirst({
      where: { id: cursor, conversationId },
      select: { seq: true }
    });
    if (!cursorMsg) {
      throw new ApiError(400, 'Invalid cursor for this conversation');
    }
    cursorSeq = cursorMsg.seq;
  }

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      ...(cursorSeq !== null ? { seq: { lt: cursorSeq } } : {})
    },
    take: queryLimit + 1,
    orderBy: [{ seq: 'desc' }, { id: 'desc' }],
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  });

  let hasNextPage = false;
  let nextCursor: string | null = null;

  if (messages.length > queryLimit) {
    hasNextPage = true;
    messages.pop();
    nextCursor = messages[messages.length - 1]?.id ?? null;
  }

  return {
    messages,
    nextCursor,
    hasNextPage
  };
};

export const getUserConversations = async (userId: string) => {
  const conversations = await prisma.conversation.findMany({
    where: {
      participants: {
        some: { userId }
      }
    },
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
        take: 1,
        orderBy: [{ seq: 'desc' }, { id: 'desc' }],
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              avatar: true
            }
          }
        }
      }
    }
  });

  if (conversations.length === 0) {
    return [];
  }

  const unreadCounts = await prisma.$queryRaw<Array<{ conversationId: string; unreadCount: number }>>`
    SELECT 
      cp."conversationId",
      COUNT(m.id)::int AS "unreadCount"
    FROM "ConversationParticipant" cp
    LEFT JOIN "Message" m ON m."conversationId" = cp."conversationId"
      AND m."senderId" != cp."userId"
      AND m."seq" > cp."lastReadSeq"
    WHERE cp."userId" = ${userId}
    GROUP BY cp."conversationId"
  `;

  const unreadMap = new Map<string, number>();
  for (const row of unreadCounts) {
    unreadMap.set(row.conversationId, Number(row.unreadCount));
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
    const participant = await tx.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId
        }
      }
    });

    if (!participant) {
      throw new ApiError(403, 'User is not a participant in this conversation');
    }

    const targetMessage = await tx.message.findFirst({
      where: {
        id: messageId,
        conversationId
      }
    });

    if (!targetMessage) {
      throw new ApiError(404, 'Message not found in this conversation');
    }

    const updateResult = await tx.conversationParticipant.updateMany({
      where: {
        conversationId,
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
              conversationId,
              userId
            }
          }
        })) || participant;

    const participants = await tx.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true }
    });

    return {
      conversationId,
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
  const participantExists = await isParticipant(userId, conversationId);
  if (!participantExists) {
    throw new ApiError(403, 'User is not a participant in this conversation');
  }

  const sanitizedQuery = query ? query.trim() : '';
  if (!sanitizedQuery) {
    return { messages: [], nextCursor: null, hasNextPage: false };
  }

  const queryLimit = Math.min(Math.max(limit, 1), 50);

  let cursorSeq: number | null = null;
  if (cursor) {
    const cursorMsg = await prisma.message.findFirst({
      where: { id: cursor, conversationId },
      select: { seq: true }
    });
    if (!cursorMsg) {
      throw new ApiError(400, 'Invalid cursor for this conversation');
    }
    cursorSeq = cursorMsg.seq;
  }

  const whereClause = {
    conversationId,
    content: {
      contains: sanitizedQuery,
      mode: 'insensitive' as const
    },
    ...(cursorSeq !== null ? { seq: { lt: cursorSeq } } : {})
  };

  const messages = await prisma.message.findMany({
    where: whereClause,
    orderBy: [{ seq: 'desc' }, { id: 'desc' }],
    take: queryLimit + 1,
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  });

  let hasNextPage = false;
  let nextCursor: string | null = null;

  if (messages.length > queryLimit) {
    hasNextPage = true;
    messages.pop();
    nextCursor = messages[messages.length - 1]?.id ?? null;
  }

  return {
    messages,
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

  const existingUsers = await prisma.user.findMany({
    where: { id: { in: uniqueUserIds } },
    select: { id: true }
  });

  if (existingUsers.length !== uniqueUserIds.length) {
    throw new ApiError(400, 'One or more participant user IDs are invalid');
  }

  const conversation = await prisma.conversation.create({
    data: {
      type: 'group',
      name: name.trim(),
      avatar: avatar || null,
      participants: {
        create: uniqueUserIds.map((userId) => ({ userId }))
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

  return conversation;
};

export const addGroupParticipants = async (
  userId: string,
  conversationId: string,
  participantIds: string[]
) => {
  const conversation = await prisma.conversation.findUnique({
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

  const isUserMember = conversation.participants.some((p) => p.userId === userId);
  if (!isUserMember) {
    throw new ApiError(403, 'You are not a member of this conversation');
  }

  const existingParticipantIds = new Set(conversation.participants.map((p) => p.userId));
  const newParticipantIds = Array.from(new Set(participantIds)).filter((id) => !existingParticipantIds.has(id));

  if (newParticipantIds.length === 0) {
    throw new ApiError(400, 'All specified users are already participants in this group');
  }

  const existingUsers = await prisma.user.findMany({
    where: { id: { in: newParticipantIds } },
    select: { id: true }
  });

  if (existingUsers.length !== newParticipantIds.length) {
    throw new ApiError(400, 'One or more specified participant user IDs do not exist');
  }

  await prisma.conversationParticipant.createMany({
    data: newParticipantIds.map((pId) => ({
      conversationId,
      userId: pId
    }))
  });

  const updated = await prisma.conversation.findUnique({
    where: { id: conversationId },
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

  return updated;
};

export const removeGroupParticipant = async (
  userId: string,
  conversationId: string,
  targetUserId: string
) => {
  const conversation = await prisma.conversation.findUnique({
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

  const isUserMember = conversation.participants.some((p) => p.userId === userId);
  if (!isUserMember) {
    throw new ApiError(403, 'You are not a member of this conversation');
  }

  const isTargetMember = conversation.participants.some((p) => p.userId === targetUserId);
  if (!isTargetMember) {
    throw new ApiError(404, 'Target user is not a participant in this conversation');
  }

  await prisma.conversationParticipant.delete({
    where: {
      conversationId_userId: {
        conversationId,
        userId: targetUserId
      }
    }
  });

  const remainingParticipants = await prisma.conversationParticipant.count({
    where: { conversationId }
  });

  if (remainingParticipants === 0) {
    await prisma.conversation.delete({
      where: { id: conversationId }
    });
    return { success: true, conversationDeleted: true };
  }

  return { success: true, conversationDeleted: false };
};

export const updateGroupConversation = async (
  userId: string,
  conversationId: string,
  updates: { name?: string; avatar?: string | null }
) => {
  const conversation = await prisma.conversation.findUnique({
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

  const isUserMember = conversation.participants.some((p) => p.userId === userId);
  if (!isUserMember) {
    throw new ApiError(403, 'You are not a member of this conversation');
  }

  const dataToUpdate: any = {};
  if (updates.name !== undefined) {
    dataToUpdate.name = updates.name.trim();
  }
  if (updates.avatar !== undefined) {
    dataToUpdate.avatar = updates.avatar;
  }

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: dataToUpdate,
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

  return updated;
};





