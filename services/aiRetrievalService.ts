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
    const isFileMatch = !!(m.fileUrl && m.fileUrl.toLowerCase().includes(trimmed.toLowerCase()));
    const displayContent = m.fileUrl
      ? (m.content ? `${m.content} [Attachment: ${m.fileUrl}]` : `Shared File: ${m.fileUrl}`)
      : m.content;

    results.push({
      id: m.id,
      type: isFileMatch ? 'document' : 'message',
      source: m.conversation.name ? `Chat: ${m.conversation.name}` : `Chat (${m.conversation.id})`,
      author: m.sender?.name || 'Unknown',
      content: displayContent,
      createdAt: m.createdAt.toISOString(),
      fileUrl: m.fileUrl,
      fileType: m.fileType
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

  const queryLower = trimmed.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter((t) => t.length > 1);

  const calculateRelevanceScore = (r: WorkspaceRecord): number => {
    let score = 0;
    const contentLower = (r.content || '').toLowerCase();
    const sourceLower = (r.source || '').toLowerCase();
    const authorLower = (r.author || '').toLowerCase();
    const fileLower = (r.fileName || '').toLowerCase();

    if (contentLower.includes(queryLower)) {
      score += 15;
    }
    if (fileLower && fileLower.includes(queryLower)) {
      score += 20;
    }
    if (sourceLower.includes(queryLower)) {
      score += 10;
    }
    if (authorLower.includes(queryLower)) {
      score += 5;
    }

    for (const token of queryTokens) {
      if (fileLower && fileLower.includes(token)) {
        score += 8;
      }
      if (contentLower.includes(token)) {
        score += 4;
        const occurrences = contentLower.split(token).length - 1;
        score += Math.min(occurrences, 5);
      }
      if (sourceLower.includes(token)) {
        score += 3;
      }
      if (authorLower.includes(token)) {
        score += 2;
      }
    }

    const recDate = new Date(r.createdAt).getTime();
    const ageDays = (Date.now() - recDate) / (1000 * 60 * 60 * 24);
    if (ageDays <= 2) {
      score += 5;
    } else if (ageDays <= 7) {
      score += 3;
    } else if (ageDays <= 30) {
      score += 1;
    }

    return score;
  };

  const scoredResults = results.map((r) => ({
    record: r,
    score: calculateRelevanceScore(r)
  }));

  scoredResults.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.record.createdAt).getTime() - new Date(a.record.createdAt).getTime();
  });

  const categoryCounts: Record<string, number> = {};
  const maxPerCategory = Math.max(Math.ceil(safeLimit * 0.5), 3);
  const prioritized: WorkspaceRecord[] = [];
  const deferred: WorkspaceRecord[] = [];

  for (const item of scoredResults) {
    const cat = item.record.type;
    const currentCount = categoryCounts[cat] || 0;
    if (currentCount < maxPerCategory) {
      prioritized.push(item.record);
      categoryCounts[cat] = currentCount + 1;
    } else {
      deferred.push(item.record);
    }
  }

  const mergedResults = [...prioritized, ...deferred].slice(0, safeLimit);
  return mergedResults;
};

export const getTimeframeCutoff = (timeframe?: string): Date | undefined => {
  if (timeframe === 'last_7_days') {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }
  if (timeframe === 'last_30_days') {
    return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
  return undefined;
};

export interface AuthorizedProjectContext {
  projectId: string;
  projectName: string;
  projectType: string;
  description: string | null;
  members: Array<{ id: string; name: string; role: string }>;
  teams?: Array<{ id: string; name: string; description: string | null }>;
  discussions: Array<{ author: string; content: string; createdAt: string; commentCount?: number }>;
  timeframeApplied?: string;
}

export const getAuthorizedProjectContext = async (
  userId: string,
  target?: { organizationId?: string; teamId?: string; communityId?: string },
  timeframe?: string
): Promise<AuthorizedProjectContext> => {
  const ids = [target?.organizationId, target?.teamId, target?.communityId].filter(Boolean);
  if (ids.length === 0) {
    throw new ApiError(400, 'A target identifier (organizationId, teamId, or communityId) is required');
  }
  if (ids.length > 1) {
    throw new ApiError(400, 'Please provide exactly one target identifier (organizationId, teamId, or communityId)');
  }

  const startDate = getTimeframeCutoff(timeframe);

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
          select: { id: true, name: true, description: true, createdAt: true }
        }
      }
    });

    if (!org) {
      throw new ApiError(404, 'Organization not found');
    }

    const activityRecords: Array<{ author: string; content: string; createdAt: string }> = [];

    for (const t of org.teams) {
      if (!startDate || t.createdAt >= startDate) {
        activityRecords.push({
          author: 'Organization Admin',
          content: `Team created: ${t.name}${t.description ? ` (${t.description})` : ''}`,
          createdAt: t.createdAt.toISOString()
        });
      }
    }

    for (const m of org.members) {
      if (!startDate || m.joinedAt >= startDate) {
        activityRecords.push({
          author: m.user?.name || 'Member',
          content: `Joined organization with role: ${m.role}`,
          createdAt: m.joinedAt.toISOString()
        });
      }
    }

    activityRecords.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
      discussions: activityRecords,
      timeframeApplied: timeframe || 'all'
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

    const activityRecords: Array<{ author: string; content: string; createdAt: string }> = [];

    if (!startDate || team.createdAt >= startDate) {
      activityRecords.push({
        author: 'Organization',
        content: `Team established under ${team.organization.name}`,
        createdAt: team.createdAt.toISOString()
      });
    }

    for (const m of team.members) {
      if (!startDate || m.joinedAt >= startDate) {
        activityRecords.push({
          author: m.user?.name || 'Member',
          content: `Joined team with role: ${m.role}`,
          createdAt: m.joinedAt.toISOString()
        });
      }
    }

    activityRecords.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
      discussions: activityRecords,
      timeframeApplied: timeframe || 'all'
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
        }
      }
    });

    if (!community) {
      throw new ApiError(404, 'Community not found');
    }

    const posts = await prisma.communityPost.findMany({
      where: {
        communityId: target.communityId,
        ...(startDate ? { createdAt: { gte: startDate } } : {})
      },
      take: 30,
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { name: true } },
        _count: { select: { comments: true } }
      }
    });

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
      discussions: posts.map((p) => ({
        author: p.author?.name || 'Unknown',
        content: p.content,
        createdAt: p.createdAt.toISOString(),
        commentCount: p._count.comments
      })),
      timeframeApplied: timeframe || 'all'
    };
  }

  throw new ApiError(400, 'A valid target identifier (organizationId, teamId, or communityId) is required');
};

