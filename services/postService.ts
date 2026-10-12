import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { CommunityRole } from './communityService.js';

export const createCommunityPost = async (
  userId: string,
  communityId: string,
  content: string
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

  const post = await prisma.communityPost.create({
    data: {
      communityId,
      authorId: userId,
      content: content.trim()
    },
    include: {
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

  return post;
};

export const getCommunityPosts = async (
  userId: string,
  communityId: string,
  cursor?: string,
  limit: number = 20
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

  const take = Math.min(Math.max(limit, 1), 50);

  const posts = await prisma.communityPost.findMany({
    where: { communityId },
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
  content: string
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

  const updated = await prisma.communityPost.update({
    where: { id: postId },
    data: {
      content: content.trim()
    },
    include: {
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
