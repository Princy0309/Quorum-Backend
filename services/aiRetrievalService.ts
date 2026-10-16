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

export interface WorkspaceRecord {
  id: string;
  type: 'message' | 'community_post' | 'organization' | 'meeting';
  source: string;
  author: string;
  content: string;
  createdAt: string;
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

export const searchAuthorizedWorkspaceRecords = async (
  userId: string,
  query: string,
  limit: number = 20
): Promise<WorkspaceRecord[]> => {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [messages, posts, orgs, meetings] = await Promise.all([
    prisma.message.findMany({
      where: {
        content: { contains: trimmed, mode: 'insensitive' },
        conversation: {
          participants: {
            some: { userId }
          }
        }
      },
      take: safeLimit,
      orderBy: { createdAt: 'desc' },
      include: {
        conversation: { select: { id: true, name: true, type: true } },
        sender: { select: { id: true, name: true } }
      }
    }),
    prisma.communityPost.findMany({
      where: {
        content: { contains: trimmed, mode: 'insensitive' },
        community: {
          members: {
            some: { userId }
          }
        }
      },
      take: safeLimit,
      orderBy: { createdAt: 'desc' },
      include: {
        community: { select: { id: true, name: true } },
        author: { select: { id: true, name: true } }
      }
    }),
    prisma.organization.findMany({
      where: {
        members: { some: { userId } },
        OR: [
          { name: { contains: trimmed, mode: 'insensitive' } },
          { description: { contains: trimmed, mode: 'insensitive' } }
        ]
      },
      take: safeLimit,
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        owner: { select: { name: true } }
      }
    }),
    prisma.meeting.findMany({
      where: {
        OR: [
          { hostId: userId },
          { admitted: { has: userId } }
        ],
        code: { contains: trimmed, mode: 'insensitive' }
      },
      take: safeLimit,
      select: {
        id: true,
        code: true,
        status: true,
        createdAt: true,
        host: { select: { name: true } }
      }
    })
  ]);

  const results: WorkspaceRecord[] = [];

  for (const m of messages) {
    results.push({
      id: m.id,
      type: 'message',
      source: m.conversation.name ? `Chat: ${m.conversation.name}` : `Chat (${m.conversation.id})`,
      author: m.sender?.name || 'Unknown',
      content: m.content,
      createdAt: m.createdAt.toISOString()
    });
  }

  for (const p of posts) {
    results.push({
      id: p.id,
      type: 'community_post',
      source: `Community: ${p.community.name}`,
      author: p.author?.name || 'Unknown',
      content: p.content,
      createdAt: p.createdAt.toISOString()
    });
  }

  for (const o of orgs) {
    results.push({
      id: o.id,
      type: 'organization',
      source: `Organization: ${o.name}`,
      author: o.owner?.name || 'Owner',
      content: o.description || o.name,
      createdAt: o.createdAt.toISOString()
    });
  }

  for (const mt of meetings) {
    results.push({
      id: mt.id,
      type: 'meeting',
      source: `Meeting: ${mt.code}`,
      author: mt.host?.name || 'Host',
      content: `Meeting code: ${mt.code}, status: ${mt.status}`,
      createdAt: mt.createdAt.toISOString()
    });
  }

  return results.slice(0, safeLimit);
};
