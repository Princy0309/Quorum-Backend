import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { CommunityRole } from './communityService.js';

export const createPostComment = async (
  userId: string,
  postId: string,
  content: string
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
    where: { id: commentId }
  });

  if (!comment) {
    throw new ApiError(404, 'Comment not found');
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

  if (comment.authorId !== userId) {
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId: comment.post.communityId,
          userId
        }
      }
    });

    if (!membership || (membership.role !== CommunityRole.OWNER && membership.role !== CommunityRole.ADMIN)) {
      throw new ApiError(403, 'You do not have permission to delete this comment');
    }
  }

  await prisma.communityComment.delete({
    where: { id: commentId }
  });

  return { message: 'Comment deleted successfully' };
};
