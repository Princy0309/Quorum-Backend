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
  const userConversations = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: { conversationId: true }
  });

  if (userConversations.length === 0) return [];

  const conversationIds = userConversations.map((c) => c.conversationId);

  const coParticipants = await prisma.conversationParticipant.findMany({
    where: {
      conversationId: { in: conversationIds },
      userId: { not: userId }
    },
    select: { userId: true },
    distinct: ['userId']
  });

  return coParticipants.map((p) => p.userId);
};

export const saveMessage = async (
  senderId: string,
  conversationId: string,
  content: string,
  fileUrl?: string,
  fileType?: string
) => {
  const participantExists = await isParticipant(senderId, conversationId);
  if (!participantExists) {
    throw new ApiError(403, 'User is not a participant in this conversation');
  }

  const updatedConversation = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      updatedAt: new Date(),
      lastSeq: { increment: 1 }
    }
  });

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId,
      content,
      fileUrl,
      fileType,
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

  const participants = await prisma.conversationParticipant.findMany({
    where: { conversationId },
    select: { userId: true }
  });

  return { message, participants };
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

  const messages = await prisma.message.findMany({
    where: { conversationId },
    take: queryLimit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
    const nextItem = messages.pop();
    nextCursor = nextItem ? nextItem.id : null;
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
  const participant = await prisma.conversationParticipant.findUnique({
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

  const targetMessage = await prisma.message.findFirst({
    where: {
      id: messageId,
      conversationId
    }
  });

  if (!targetMessage) {
    throw new ApiError(404, 'Message not found in this conversation');
  }

  if (participant.lastReadSeq >= targetMessage.seq) {
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true }
    });
    return { conversationId, userId, messageId: participant.lastReadMessageId, participants };
  }

  await prisma.conversationParticipant.update({
    where: {
      conversationId_userId: {
        conversationId,
        userId
      }
    },
    data: {
      lastReadMessageId: messageId,
      lastReadSeq: targetMessage.seq
    }
  });

  const participants = await prisma.conversationParticipant.findMany({
    where: { conversationId },
    select: { userId: true }
  });

  return { conversationId, userId, messageId, participants };
};

export const searchConversationMessages = async (
  userId: string,
  conversationId: string,
  query: string,
  page: number = 1,
  limit: number = 20
) => {
  const participantExists = await isParticipant(userId, conversationId);
  if (!participantExists) {
    throw new ApiError(403, 'User is not a participant in this conversation');
  }

  const sanitizedQuery = query ? query.trim() : '';
  if (!sanitizedQuery) {
    return { messages: [], total: 0, page, totalPages: 0 };
  }

  const queryPage = Math.max(page, 1);
  const queryLimit = Math.min(Math.max(limit, 1), 50);
  const skip = (queryPage - 1) * queryLimit;

  const whereClause = {
    conversationId,
    content: {
      contains: sanitizedQuery,
      mode: 'insensitive' as const
    }
  };

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: whereClause,
      orderBy: [{ seq: 'desc' }, { id: 'desc' }],
      skip,
      take: queryLimit,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        }
      }
    }),
    prisma.message.count({ where: whereClause })
  ]);

  return {
    messages,
    total,
    page: queryPage,
    totalPages: Math.ceil(total / queryLimit)
  };
};





