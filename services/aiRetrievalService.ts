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
  type: 'message' | 'community_post' | 'organization' | 'meeting' | 'document';
  source: string;
  author: string;
  content: string;
  createdAt: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
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
        OR: [
          { content: { contains: trimmed, mode: 'insensitive' } },
          { fileName: { contains: trimmed, mode: 'insensitive' } }
        ],
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
        OR: [
          { content: { contains: trimmed, mode: 'insensitive' } },
          { fileName: { contains: trimmed, mode: 'insensitive' } }
        ],
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
    const isFileMatch = m.fileName && m.fileName.toLowerCase().includes(trimmed.toLowerCase());
    const displayContent = m.fileName
      ? (m.content ? `${m.content} [Attached File: ${m.fileName}]` : `Shared File: ${m.fileName}`)
      : m.content;

    results.push({
      id: m.id,
      type: isFileMatch ? 'document' : 'message',
      source: m.conversation.name ? `Chat: ${m.conversation.name}` : `Chat (${m.conversation.id})`,
      author: m.sender?.name || 'Unknown',
      content: displayContent,
      createdAt: m.createdAt.toISOString(),
      fileUrl: m.fileUrl,
      fileName: m.fileName,
      fileType: m.fileType
    });
  }

  for (const p of posts) {
    const isFileMatch = p.fileName && p.fileName.toLowerCase().includes(trimmed.toLowerCase());
    const displayContent = p.fileName
      ? (p.content ? `${p.content} [Attached File: ${p.fileName}]` : `Shared File: ${p.fileName}`)
      : p.content;

    results.push({
      id: p.id,
      type: isFileMatch ? 'document' : 'community_post',
      source: `Community: ${p.community.name}`,
      author: p.author?.name || 'Unknown',
      content: displayContent,
      createdAt: p.createdAt.toISOString(),
      fileUrl: p.fileUrl,
      fileName: p.fileName,
      fileType: p.fileType
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

export interface AuthorizedProjectContext {
  projectId: string;
  projectName: string;
  projectType: string;
  description: string | null;
  members: Array<{ id: string; name: string; role: string }>;
  teams?: Array<{ id: string; name: string; description: string | null }>;
  discussions: Array<{ author: string; content: string; createdAt: string; commentCount?: number }>;
}

export const getAuthorizedProjectContext = async (
  userId: string,
  target?: { organizationId?: string; teamId?: string; communityId?: string }
): Promise<AuthorizedProjectContext> => {
  if (target?.organizationId) {
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: target.organizationId,
          userId
        }
      }
    });

    if (!orgMember) {
      throw new ApiError(403, 'User is not authorized to access this organization');
    }

    const org = await prisma.organization.findUnique({
      where: { id: target.organizationId },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true } }
          }
        },
        teams: {
          select: { id: true, name: true, description: true }
        }
      }
    });

    if (!org) {
      throw new ApiError(404, 'Organization not found');
    }

    return {
      projectId: org.id,
      projectName: org.name,
      projectType: 'organization',
      description: org.description,
      members: org.members.map((m) => ({
        id: m.userId,
        name: m.user?.name || 'Member',
        role: m.role
      })),
      teams: org.teams,
      discussions: []
    };
  }

  if (target?.teamId) {
    const teamMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: target.teamId,
          userId
        }
      }
    });

    if (!teamMember) {
      throw new ApiError(403, 'User is not authorized to access this team');
    }

    const team = await prisma.team.findUnique({
      where: { id: target.teamId },
      include: {
        organization: { select: { id: true, name: true } },
        members: {
          include: {
            user: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (!team) {
      throw new ApiError(404, 'Team not found');
    }

    return {
      projectId: team.id,
      projectName: `${team.organization.name} - ${team.name}`,
      projectType: 'team',
      description: team.description,
      members: team.members.map((m) => ({
        id: m.userId,
        name: m.user?.name || 'Member',
        role: m.role
      })),
      discussions: []
    };
  }

  if (target?.communityId) {
    const communityMember = await prisma.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId: target.communityId,
          userId
        }
      }
    });

    if (!communityMember) {
      throw new ApiError(403, 'User is not authorized to access this community project');
    }

    const community = await prisma.community.findUnique({
      where: { id: target.communityId },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true } }
          }
        },
        posts: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          include: {
            author: { select: { name: true } },
            _count: { select: { comments: true } }
          }
        }
      }
    });

    if (!community) {
      throw new ApiError(404, 'Community not found');
    }

    return {
      projectId: community.id,
      projectName: community.name,
      projectType: 'community',
      description: community.description,
      members: community.members.map((m) => ({
        id: m.userId,
        name: m.user?.name || 'Member',
        role: m.role
      })),
      discussions: community.posts.map((p) => ({
        author: p.author?.name || 'Unknown',
        content: p.content,
        createdAt: p.createdAt.toISOString(),
        commentCount: p._count.comments
      }))
    };
  }

  const userOrgs = await prisma.organizationMember.findMany({
    where: { userId },
    take: 5,
    include: {
      organization: {
        include: {
          teams: { select: { id: true, name: true, description: true } },
          members: { include: { user: { select: { id: true, name: true } } } }
        }
      }
    }
  });

  if (userOrgs.length > 0) {
    const primary = userOrgs[0].organization;
    return {
      projectId: primary.id,
      projectName: primary.name,
      projectType: 'organization',
      description: primary.description,
      members: primary.members.map((m) => ({
        id: m.userId,
        name: m.user?.name || 'Member',
        role: m.role
      })),
      teams: primary.teams,
      discussions: []
    };
  }

  const userCommunities = await prisma.communityMember.findMany({
    where: { userId },
    take: 1,
    include: {
      community: {
        include: {
          members: { include: { user: { select: { id: true, name: true } } } },
          posts: {
            take: 20,
            orderBy: { createdAt: 'desc' },
            include: {
              author: { select: { name: true } },
              _count: { select: { comments: true } }
            }
          }
        }
      }
    }
  });

  if (userCommunities.length > 0) {
    const primary = userCommunities[0].community;
    return {
      projectId: primary.id,
      projectName: primary.name,
      projectType: 'community',
      description: primary.description,
      members: primary.members.map((m) => ({
        id: m.userId,
        name: m.user?.name || 'Member',
        role: m.role
      })),
      discussions: primary.posts.map((p) => ({
        author: p.author?.name || 'Unknown',
        content: p.content,
        createdAt: p.createdAt.toISOString(),
        commentCount: p._count.comments
      }))
    };
  }

  throw new ApiError(404, 'No active organizations, teams, or communities found for this user');
};

