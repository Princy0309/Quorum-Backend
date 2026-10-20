import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { CommunityRole } from './communityService.js';
import { queueNotification } from '../queues/notificationQueue.js';
import logger from '../utils/logger.js';

export const createPostComment = async (
  userId: string,
  postId: string,
  content: string
) => {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, communityId: true, authorId: true }
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
    throw new ApiError(403, 'Access denied. You are not a member of this community');
  }

  const comment = await prisma.communityComment.create({
    data: {
      postId,
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
      }
    }
  });

  if (post.authorId !== userId) {
    try {
      await queueNotification({
        recipientId: post.authorId,
        actorId: userId,
        type: 'COMMUNITY_POST_COMMENT',
        title: 'New Comment on Your Post',
        body: `${comment.author.name} commented: "${content.trim().slice(0, 50)}${content.trim().length > 50 ? '...' : ''}"`,
        data: {
          communityId: post.communityId,
          postId: post.id,
          commentId: comment.id
        }
      });
    } catch (err: any) {
      logger.warn('[CommunityComment] Notification trigger failed', { error: err.message });
    }
  }

  return comment;
};

export const getPostComments = async (
  userId: string,
  postId: string,
  cursor?: string,
  limit: number = 20
) => {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, communityId: true }
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
    throw new ApiError(403, 'Access denied. You are not a member of this community');
  }

  const take = Math.min(Math.max(limit, 1), 50);

  if (cursor) {
    const cursorComment = await prisma.communityComment.findFirst({
      where: {
        id: cursor,
        postId
      }
    });

    if (!cursorComment) {
      throw new ApiError(400, 'Invalid pagination cursor for this post');
    }
  }

  const comments = await prisma.communityComment.findMany({
    where: { postId },
    take: take + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      author: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  });

  const hasNextPage = comments.length > take;
  const pagedComments = hasNextPage ? comments.slice(0, take) : comments;
  const nextCursor = hasNextPage && pagedComments.length > 0 ? pagedComments[pagedComments.length - 1].id : null;

  return {
    comments: pagedComments,
    nextCursor,
    hasNextPage
  };
};

export const updatePostComment = async (
  userId: string,
  commentId: string,
  content: string
) => {
  const comment = await prisma.communityComment.findUnique({
    where: { id: commentId },
    include: {
      post: {
        select: {
          communityId: true
        }
      }
    }
  });

  if (!comment) {
    throw new ApiError(404, 'Comment not found');
  }

  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: comment.post.communityId,
        userId
      }
    }
  });

  if (!membership) {
    throw new ApiError(403, 'Access denied. You are no longer a member of this community');
  }

  if (comment.authorId !== userId) {
    throw new ApiError(403, 'You can only edit your own comments');
  }

  const updated = await prisma.communityComment.update({
    where: { id: commentId },
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
      }
    }
  });

  return updated;
};

export const deletePostComment = async (
  userId: string,
  commentId: string
) => {
  const comment = await prisma.communityComment.findUnique({
    where: { id: commentId },
    include: {
      post: {
        select: {
          communityId: true
        }
      }
    }
  });

  if (!comment) {
    throw new ApiError(404, 'Comment not found');
  }

  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: comment.post.communityId,
        userId
      }
    }
  });

  if (!membership) {
    throw new ApiError(403, 'Access denied. You are no longer a member of this community');
  }

  if (comment.authorId !== userId) {
    if (membership.role !== CommunityRole.OWNER && membership.role !== CommunityRole.ADMIN) {
      throw new ApiError(403, 'You do not have permission to delete this comment');
    }
  }

  await prisma.communityComment.delete({
    where: { id: commentId }
  });

  return { message: 'Comment deleted successfully' };
};
