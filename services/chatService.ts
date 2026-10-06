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

