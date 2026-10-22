import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { CommunityRole, ensureDefaultGeneralChannel } from './communityService.js';

export interface CommunityPostInput {
  content?: string;
  fileUrl?: string | null;
  fileType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  channelId?: string | null;
}

export const createCommunityPost = async (
  userId: string,
  communityId: string,
  postData: CommunityPostInput | string
) => {
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId,
        userId
      }
    }
  });

  if (!membership) {
    throw new ApiError(403, 'Access denied. You are not a member of this community');
  }

  const content = typeof postData === 'string' ? postData : (postData.content || '');
  const fileUrl = typeof postData === 'object' && postData.fileUrl ? postData.fileUrl.trim() : null;
  const fileType = typeof postData === 'object' && postData.fileType ? postData.fileType.trim() : null;
  const fileName = typeof postData === 'object' && postData.fileName ? postData.fileName.trim() : null;
  const fileSize = typeof postData === 'object' && typeof postData.fileSize === 'number' ? postData.fileSize : null;

  let targetChannelId: string;
  if (typeof postData === 'object' && postData.channelId) {
    const channel = await prisma.communityChannel.findUnique({
      where: { id: postData.channelId }
    });
    if (!channel || channel.communityId !== communityId) {
      throw new ApiError(400, 'Invalid channel for this community');
    }
    targetChannelId = channel.id;
  } else {
    const defaultGeneral = await ensureDefaultGeneralChannel(communityId);
    if (!defaultGeneral) {
      throw new ApiError(500, 'Failed to resolve default channel for community');
    }
    targetChannelId = defaultGeneral.id;
  }

  const post = await prisma.communityPost.create({
    data: {
      communityId,
      channelId: targetChannelId,
      authorId: userId,
      content: content.trim(),
      fileUrl,
      fileType,
      fileName,
      fileSize
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      channel: {
        select: {
          id: true,
          name: true,
          isDefault: true
        }
      },
      _count: {
        select: {
          comments: true
        }
      }
    }
  });

  return post;
};

export const getCommunityPosts = async (
  userId: string,
  communityId: string,
  cursor?: string,
  limit: number = 20,
  channelId?: string,
  search?: string
) => {
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId,
        userId
      }
    }
  });

  if (!membership) {
    throw new ApiError(403, 'Access denied. You are not a member of this community');
  }

  if (channelId) {
    const channel = await prisma.communityChannel.findUnique({
      where: { id: channelId }
    });
    if (!channel || channel.communityId !== communityId) {
      throw new ApiError(404, 'Channel not found in this community');
    }
  }

  const take = Math.min(Math.max(limit, 1), 50);

  if (cursor) {
    const cursorPost = await prisma.communityPost.findFirst({
      where: {
        id: cursor,
        communityId
      }
    });

    if (!cursorPost) {
      throw new ApiError(400, 'Invalid pagination cursor for this community');
    }
  }

  const whereClause: any = {
    communityId,
    ...(channelId ? { channelId } : {}),
    ...(search && search.trim() ? {
      content: {
        contains: search.trim(),
        mode: 'insensitive'
      }
    } : {})
  };

  const posts = await prisma.communityPost.findMany({
    where: whereClause,
    take: take + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      author: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      channel: {
        select: {
          id: true,
          name: true,
          isDefault: true
        }
      },
      _count: {
        select: {
          comments: true
        }
      }
    }
  });

  const hasNextPage = posts.length > take;
  const pagedPosts = hasNextPage ? posts.slice(0, take) : posts;
  const nextCursor = hasNextPage && pagedPosts.length > 0 ? pagedPosts[pagedPosts.length - 1].id : null;

  return {
    posts: pagedPosts,
    nextCursor,
    hasNextPage
  };
};

export const getCommunityFeed = async (
  userId: string,
  cursor?: string,
  limit: number = 20
) => {
  const userMemberships = await prisma.communityMember.findMany({
    where: { userId },
    select: { communityId: true }
  });

  const joinedCommunityIds = userMemberships.map((m) => m.communityId);
  if (joinedCommunityIds.length === 0) {
    return {
      posts: [],
      nextCursor: null,
      hasNextPage: false
    };
  }

  const take = Math.min(Math.max(limit, 1), 50);

  if (cursor) {
    const cursorPost = await prisma.communityPost.findFirst({
      where: {
        id: cursor,
        communityId: { in: joinedCommunityIds }
      }
    });

    if (!cursorPost) {
      throw new ApiError(400, 'Invalid pagination cursor');
    }
  }

  const posts = await prisma.communityPost.findMany({
    where: {
      communityId: { in: joinedCommunityIds }
    },
    take: take + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      community: {
        select: {
          id: true,
          name: true,
          description: true
        }
      },
      channel: {
        select: {
          id: true,
          name: true,
          isDefault: true
        }
      },
      author: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      _count: {
        select: {
          comments: true
        }
      }
    }
  });

  const hasNextPage = posts.length > take;
  const pagedPosts = hasNextPage ? posts.slice(0, take) : posts;
  const nextCursor = hasNextPage && pagedPosts.length > 0 ? pagedPosts[pagedPosts.length - 1].id : null;

  return {
    posts: pagedPosts,
    nextCursor,
    hasNextPage
  };
};

export const updateCommunityPost = async (
  userId: string,
  postId: string,
  postData: CommunityPostInput | string
) => {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId }
  });

  if (!post) {
    throw new ApiError(404, 'Post not found');
  }

  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: post.communityId,
        userId
      }
    }
  });

  if (!membership) {
    throw new ApiError(403, 'Access denied. You are no longer a member of this community');
  }

  if (post.authorId !== userId) {
    throw new ApiError(403, 'You can only edit your own posts');
  }

  const dataToUpdate: any = {};
  if (typeof postData === 'string') {
    dataToUpdate.content = postData.trim();
  } else {
    if (typeof postData.content === 'string') {
      dataToUpdate.content = postData.content.trim();
    }
    if (postData.fileUrl !== undefined) {
      dataToUpdate.fileUrl = postData.fileUrl ? postData.fileUrl.trim() : null;
      if (!dataToUpdate.fileUrl) {
        if (postData.fileType === undefined) dataToUpdate.fileType = null;
        if (postData.fileName === undefined) dataToUpdate.fileName = null;
        if (postData.fileSize === undefined) dataToUpdate.fileSize = null;
      }
    }
    if (postData.fileType !== undefined) {
      dataToUpdate.fileType = postData.fileType ? postData.fileType.trim() : null;
    }
    if (postData.fileName !== undefined) {
      dataToUpdate.fileName = postData.fileName ? postData.fileName.trim() : null;
    }
    if (postData.fileSize !== undefined) {
      dataToUpdate.fileSize = typeof postData.fileSize === 'number' ? postData.fileSize : null;
    }
  }

  const finalContent = dataToUpdate.content !== undefined ? dataToUpdate.content : post.content;
  const finalFileUrl = dataToUpdate.fileUrl !== undefined ? dataToUpdate.fileUrl : post.fileUrl;

  const hasContent = typeof finalContent === 'string' && finalContent.trim().length > 0;
  const hasFile = typeof finalFileUrl === 'string' && finalFileUrl.trim().length > 0;

  if (!hasContent && !hasFile) {
    throw new ApiError(400, 'Post cannot be empty. It must contain either text content or a file attachment');
  }

  const updated = await prisma.communityPost.update({
    where: { id: postId },
    data: dataToUpdate,
    include: {
      author: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      channel: {
        select: {
          id: true,
          name: true,
          isDefault: true
        }
      },
      _count: {
        select: {
          comments: true
        }
      }
    }
  });

  return updated;
};

export const deleteCommunityPost = async (
  userId: string,
  postId: string
) => {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId }
  });

  if (!post) {
    throw new ApiError(404, 'Post not found');
  }

  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: post.communityId,
        userId
      }
    }
  });

  if (!membership) {
    throw new ApiError(403, 'Access denied. You are no longer a member of this community');
  }

  if (post.authorId !== userId) {
    if (membership.role !== CommunityRole.OWNER && membership.role !== CommunityRole.ADMIN) {
      throw new ApiError(403, 'You do not have permission to delete this post');
    }
  }

  await prisma.communityPost.delete({
    where: { id: postId }
  });

  return { message: 'Post deleted successfully' };
};
