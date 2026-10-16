import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';

export interface RetrievedConversationData {
  conversation: {
    id: string;
    type: string;
    name: string | null;
    participantCount: number;
  };
  messages: Array<{
    id: string;
    senderId: string;
    senderName: string;
    content: string;
    fileUrl: string | null;
    createdAt: Date;
    seq: number;
  }>;
}

export const getAuthorizedConversationMessages = async (
  userId: string,
  conversationId: string,
  limit: number = 50
): Promise<RetrievedConversationData> => {
  if (!conversationId || typeof conversationId !== 'string') {
    throw new ApiError(400, 'Invalid conversation ID');
  }

  const participant = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId
      }
    }
  });

  if (!participant) {
    throw new ApiError(403, 'User is not authorized to access this conversation');
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        select: {
          id: true,
          userId: true
        }
      }
    }
  });

  if (!conversation) {
    throw new ApiError(404, 'Conversation not found');
  }

  const safeLimit = Math.min(Math.max(limit, 1), 200);

  const rawMessages = await prisma.message.findMany({
    where: { conversationId },
    take: safeLimit,
    orderBy: { seq: 'desc' },
    include: {
      sender: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  const chronologicalMessages = rawMessages.reverse().map((msg) => ({
    id: msg.id,
    senderId: msg.senderId,
    senderName: msg.sender?.name || 'Unknown',
    content: msg.content,
    fileUrl: msg.fileUrl,
    createdAt: msg.createdAt,
    seq: msg.seq
  }));

  return {
    conversation: {
      id: conversation.id,
      type: conversation.type,
      name: conversation.name,
      participantCount: conversation.participants.length
    },
    messages: chronologicalMessages
  };
};
