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
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!conversation) {
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
          orderBy: { createdAt: 'desc' }
        }
      }
    });
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

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId,
      content,
      fileUrl,
      fileType
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

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() }
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
    orderBy: { createdAt: 'desc' },
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
  const userParticipants = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: {
      conversationId: true,
      lastReadMessageId: true
    }
  });

  const conversationIds = userParticipants.map((p) => p.conversationId);
  const participantMap = new Map(userParticipants.map((p) => [p.conversationId, p.lastReadMessageId]));

  const conversations = await prisma.conversation.findMany({
    where: { id: { in: conversationIds } },
    orderBy: { updatedAt: 'desc' },
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
        orderBy: { createdAt: 'desc' },
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

  const conversationsWithUnread = await Promise.all(
    conversations.map(async (conv) => {
      const lastReadId = participantMap.get(conv.id);
      let unreadCount = 0;

      if (lastReadId) {
        const lastReadMsg = await prisma.message.findUnique({
          where: { id: lastReadId },
          select: { createdAt: true }
        });

        if (lastReadMsg) {
          unreadCount = await prisma.message.count({
            where: {
              conversationId: conv.id,
              senderId: { not: userId },
              createdAt: { gt: lastReadMsg.createdAt }
            }
          });
        } else {
          unreadCount = await prisma.message.count({
            where: {
              conversationId: conv.id,
              senderId: { not: userId }
            }
          });
        }
      } else {
        unreadCount = await prisma.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: userId }
          }
        });
      }

      return {
        ...conv,
        lastMessage: conv.messages[0] || null,
        unreadCount
      };
    })
  );

  return conversationsWithUnread;
};

export const markMessageAsRead = async (
  userId: string,
  conversationId: string,
  messageId: string
) => {
  const participantExists = await isParticipant(userId, conversationId);
  if (!participantExists) {
    throw new ApiError(403, 'User is not a participant in this conversation');
  }

  await prisma.conversationParticipant.update({
    where: {
      conversationId_userId: {
        conversationId,
        userId
      }
    },
    data: {
      lastReadMessageId: messageId
    }
  });

  const participants = await prisma.conversationParticipant.findMany({
    where: { conversationId },
    select: { userId: true }
  });

  return { conversationId, userId, messageId, participants };
};




