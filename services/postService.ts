import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { CommunityRole } from './communityService.js';

export interface CommunityPostInput {
  content?: string;
  fileUrl?: string | null;
  fileType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
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

  const post = await prisma.communityPost.create({
    data: {
      communityId,
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
