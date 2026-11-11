import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { OrgRole, OrgPostCategory, Prisma } from '@prisma/client';
import type {
  CreateOrgPostInput,
  UpdateOrgPostInput,
  GetOrgFeedQuery,
  CreateOrgCommentInput,
  UpdateOrgCommentInput,
  OrgFeedReactionSummary,
} from '../types/index.js';

const MAX_PINNED_ORG_POSTS = 5;

const PRIVILEGED_CATEGORIES = new Set<OrgPostCategory>([
  OrgPostCategory.ANNOUNCEMENT,
  OrgPostCategory.FESTIVAL,
]);

const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  avatar: true,
} as const;

const ORG_POST_INCLUDE = {
  author: { select: USER_PUBLIC_SELECT },
  targetUser: { select: USER_PUBLIC_SELECT },
  pinnedBy: { select: USER_PUBLIC_SELECT },
  targetTeam: { select: { id: true, name: true } },
  reactions: { select: { emoji: true, userId: true } },
  _count: { select: { comments: true } },
} as const;

const isOrgModerator = (role: OrgRole): boolean =>
  role === OrgRole.ORG_ADMIN || role === OrgRole.TEAM_HEAD;

const requireActiveOrgMember = async (orgId: string, userId: string) => {
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: orgId,
        userId,
      },
    },
  });

  if (!membership) {
    throw new ApiError(403, 'Access denied: You are not a member of this organization');
  }

  return membership;
};

const requireOrgPostInOrg = async (orgId: string, postId: string) => {
  const post = await prisma.orgFeedPost.findUnique({
    where: { id: postId },
  });

  if (!post || post.organizationId !== orgId) {
    throw new ApiError(404, 'Organization feed post not found');
  }

  return post;
};

const validatePostTargets = async (
  orgId: string,
  targets: {
    targetTeamId?: string | null;
    targetUserId?: string | null;
    mentionedUserIds?: string[];
  }
) => {
  if (targets.targetTeamId) {
    const team = await prisma.team.findFirst({
      where: { id: targets.targetTeamId, organizationId: orgId },
      select: { id: true },
    });
    if (!team) {
      throw new ApiError(400, 'Target team does not belong to this organization');
    }
  }

  const userIdsToCheck = Array.from(
    new Set([
      ...(targets.targetUserId ? [targets.targetUserId] : []),
      ...(targets.mentionedUserIds || []),
    ])
  );

  if (userIdsToCheck.length === 0) {
    return { validMentionIds: [] as string[] };
  }

  const validMembers = await prisma.organizationMember.findMany({
    where: {
      organizationId: orgId,
      userId: { in: userIdsToCheck },
    },
    select: { userId: true },
  });

  const validMemberSet = new Set(validMembers.map((m) => m.userId));

  if (targets.targetUserId && !validMemberSet.has(targets.targetUserId)) {
    throw new ApiError(400, 'Target user is not a member of this organization');
  }

  const validMentionIds = (targets.mentionedUserIds || []).filter((id) =>
    validMemberSet.has(id)
  );

  return { validMentionIds };
};

const formatReactions = (
  reactions: Array<{ emoji: string; userId: string }>,
  currentUserId: string
): OrgFeedReactionSummary[] => {
  const map = new Map<string, { count: number; reactedByMe: boolean }>();

  for (const r of reactions) {
    const existing = map.get(r.emoji) || { count: 0, reactedByMe: false };
    existing.count += 1;
    if (r.userId === currentUserId) {
      existing.reactedByMe = true;
    }
    map.set(r.emoji, existing);
  }

  return Array.from(map.entries())
    .map(([emoji, stats]) => ({
      emoji,
      count: stats.count,
      reactedByMe: stats.reactedByMe,
    }))
    .sort((a, b) => b.count - a.count);
};

const formatOrgFeedPost = (post: any, currentUserId: string) => {
  const { reactions, _count, ...rest } = post;
  return {
    ...rest,
    commentCount: _count?.comments ?? 0,
    reactions: formatReactions(reactions || [], currentUserId),
  };
};

export const createOrgFeedPost = async (
  orgId: string,
  userId: string,
  input: CreateOrgPostInput
) => {
  const membership = await requireActiveOrgMember(orgId, userId);

  const category = input.category || OrgPostCategory.GENERAL;
  if (PRIVILEGED_CATEGORIES.has(category) && !isOrgModerator(membership.role)) {
    throw new ApiError(
      403,
      `Only Organization Admins or Team Heads can create ${category.toLowerCase()} posts`
    );
  }

  const cleanContent = (input.content || '').trim();
  const cleanFileUrl = input.fileUrl ? input.fileUrl.trim() : null;

  if (!cleanContent && !cleanFileUrl) {
    throw new ApiError(400, 'Post must contain either text content or a media attachment');
  }

  const { validMentionIds } = await validatePostTargets(orgId, {
    targetTeamId: input.targetTeamId,
    targetUserId: input.targetUserId,
    mentionedUserIds: input.mentionedUserIds,
  });

  const post = await prisma.orgFeedPost.create({
    data: {
      organizationId: orgId,
      authorId: userId,
      category,
      title: input.title ? input.title.trim() : null,
      content: cleanContent,
      fileUrl: cleanFileUrl,
      fileType: cleanFileUrl ? (input.fileType || null) : null,
      fileName: cleanFileUrl ? (input.fileName?.trim() || null) : null,
      fileSize: cleanFileUrl ? (input.fileSize || null) : null,
      targetUserId: input.targetUserId || null,
      targetTeamId: input.targetTeamId || null,
      mentionedUserIds: validMentionIds,
    },
    include: ORG_POST_INCLUDE,
  });

  logger.info(`OrgFeedPost created (${post.id}) in org ${orgId} by user ${userId} [${category}]`);
  return formatOrgFeedPost(post, userId);
};

export const getOrgFeed = async (
  orgId: string,
  userId: string,
  query: GetOrgFeedQuery = {}
) => {
  await requireActiveOrgMember(orgId, userId);

  const take = Math.min(Math.max(query.limit || 20, 1), 50);

  if (query.cursor) {
    const cursorPost = await prisma.orgFeedPost.findFirst({
      where: { id: query.cursor, organizationId: orgId },
      select: { id: true },
    });
    if (!cursorPost) {
      throw new ApiError(400, 'Invalid pagination cursor for this organization');
    }
  }

  const trimmedSearch = query.search?.trim();

  const whereClause: Prisma.OrgFeedPostWhereInput = {
    organizationId: orgId,
    ...(query.category ? { category: query.category } : {}),
    ...(query.teamId ? { targetTeamId: query.teamId } : {}),
    ...(query.pinnedOnly ? { isPinned: true } : {}),
    ...(trimmedSearch
      ? {
          OR: [
            { title: { contains: trimmedSearch, mode: 'insensitive' } },
            { content: { contains: trimmedSearch, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const posts = await prisma.orgFeedPost.findMany({
    where: whereClause,
    take: take + 1,
    skip: query.cursor ? 1 : 0,
    cursor: query.cursor ? { id: query.cursor } : undefined,
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    include: ORG_POST_INCLUDE,
  });

  const hasNextPage = posts.length > take;
  const pagedPosts = hasNextPage ? posts.slice(0, take) : posts;
  const nextCursor =
    hasNextPage && pagedPosts.length > 0 ? pagedPosts[pagedPosts.length - 1].id : null;

  return {
    posts: pagedPosts.map((p) => formatOrgFeedPost(p, userId)),
    nextCursor,
    hasNextPage,
  };
};

export const getOrgFeedPostById = async (
  orgId: string,
  userId: string,
  postId: string
) => {
  await requireActiveOrgMember(orgId, userId);
  await requireOrgPostInOrg(orgId, postId);

  const post = await prisma.orgFeedPost.findUnique({
    where: { id: postId },
    include: ORG_POST_INCLUDE,
  });

  return formatOrgFeedPost(post, userId);
};

export const updateOrgFeedPost = async (
  orgId: string,
  userId: string,
  postId: string,
  input: UpdateOrgPostInput
) => {
  const membership = await requireActiveOrgMember(orgId, userId);
  const existing = await requireOrgPostInOrg(orgId, postId);

  if (existing.isSystemGenerated) {
    throw new ApiError(403, 'System-generated celebration posts cannot be edited');
  }

  if (existing.authorId !== userId) {
    throw new ApiError(403, 'You can only edit your own posts');
  }

  if (input.category && PRIVILEGED_CATEGORIES.has(input.category) && !isOrgModerator(membership.role)) {
    throw new ApiError(
      403,
      `Only Organization Admins or Team Heads can set category to ${input.category.toLowerCase()}`
    );
  }

  const { validMentionIds } = await validatePostTargets(orgId, {
    targetTeamId: input.targetTeamId,
    targetUserId: input.targetUserId,
    mentionedUserIds: input.mentionedUserIds,
  });

  const dataToUpdate: Prisma.OrgFeedPostUncheckedUpdateInput = {
    isEdited: true,
    editedAt: new Date(),
  };

  if (input.category !== undefined) dataToUpdate.category = input.category;
  if (input.title !== undefined) dataToUpdate.title = input.title ? input.title.trim() : null;
  if (input.content !== undefined) dataToUpdate.content = input.content.trim();

  if (input.fileUrl !== undefined) {
    const cleanUrl = input.fileUrl ? input.fileUrl.trim() : null;
    dataToUpdate.fileUrl = cleanUrl;
    if (!cleanUrl) {
      dataToUpdate.fileType = null;
      dataToUpdate.fileName = null;
      dataToUpdate.fileSize = null;
    }
  }
  if (dataToUpdate.fileUrl !== null) {
    if (input.fileType !== undefined) dataToUpdate.fileType = input.fileType;
    if (input.fileName !== undefined) dataToUpdate.fileName = input.fileName ? input.fileName.trim() : null;
    if (input.fileSize !== undefined) dataToUpdate.fileSize = input.fileSize;
  }

  if (input.targetUserId !== undefined) dataToUpdate.targetUserId = input.targetUserId;
  if (input.targetTeamId !== undefined) dataToUpdate.targetTeamId = input.targetTeamId;
  if (input.mentionedUserIds !== undefined) dataToUpdate.mentionedUserIds = validMentionIds;

  const finalContent =
    typeof dataToUpdate.content === 'string' ? dataToUpdate.content : existing.content;
  const finalFileUrl =
    dataToUpdate.fileUrl !== undefined ? (dataToUpdate.fileUrl as string | null) : existing.fileUrl;

  if (!finalContent.trim() && !finalFileUrl) {
    throw new ApiError(400, 'Post cannot be empty. Provide text content or a media attachment');
  }

  const updated = await prisma.orgFeedPost.update({
    where: { id: postId },
    data: dataToUpdate,
    include: ORG_POST_INCLUDE,
  });

  return formatOrgFeedPost(updated, userId);
};

export const deleteOrgFeedPost = async (
  orgId: string,
  userId: string,
  postId: string
) => {
  const membership = await requireActiveOrgMember(orgId, userId);
  const existing = await requireOrgPostInOrg(orgId, postId);

  if (existing.authorId !== userId && !isOrgModerator(membership.role)) {
    throw new ApiError(403, 'You do not have permission to delete this post');
  }

  await prisma.orgFeedPost.delete({
    where: { id: postId },
  });

  logger.info(`OrgFeedPost deleted (${postId}) in org ${orgId} by user ${userId}`);
  return { deleted: true, postId };
};

export const togglePinOrgPost = async (
  orgId: string,
  userId: string,
  postId: string
) => {
  const membership = await requireActiveOrgMember(orgId, userId);
  if (!isOrgModerator(membership.role)) {
    throw new ApiError(403, 'Only Organization Admins or Team Heads can pin or unpin posts');
  }

  const existing = await requireOrgPostInOrg(orgId, postId);
  const willPin = !existing.isPinned;

  if (willPin) {
    const pinnedCount = await prisma.orgFeedPost.count({
      where: { organizationId: orgId, isPinned: true },
    });
    if (pinnedCount >= MAX_PINNED_ORG_POSTS) {
      throw new ApiError(
        400,
        `Maximum of ${MAX_PINNED_ORG_POSTS} pinned posts allowed per organization. Unpin one first.`
      );
    }
  }

  const updated = await prisma.orgFeedPost.update({
    where: { id: postId },
    data: {
      isPinned: willPin,
      pinnedAt: willPin ? new Date() : null,
      pinnedById: willPin ? userId : null,
    },
    include: ORG_POST_INCLUDE,
  });

  return formatOrgFeedPost(updated, userId);
};

export const toggleOrgPostReaction = async (
  orgId: string,
  userId: string,
  postId: string,
  emoji: string
) => {
  await requireActiveOrgMember(orgId, userId);
  await requireOrgPostInOrg(orgId, postId);

  const cleanEmoji = emoji.trim();
  const existing = await prisma.orgFeedReaction.findUnique({
    where: {
      postId_userId_emoji: {
        postId,
        userId,
        emoji: cleanEmoji,
      },
    },
  });

  let action: 'added' | 'removed';

  if (existing) {
    await prisma.orgFeedReaction.delete({ where: { id: existing.id } });
    action = 'removed';
  } else {
    try {
      await prisma.orgFeedReaction.create({
        data: {
          postId,
          userId,
          emoji: cleanEmoji,
        },
      });
      action = 'added';
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        action = 'added';
      } else {
        throw err;
      }
    }
  }

  const allReactions = await prisma.orgFeedReaction.findMany({
    where: { postId },
    select: { emoji: true, userId: true },
  });

  return {
    postId,
    emoji: cleanEmoji,
    action,
    reactions: formatReactions(allReactions, userId),
  };
};

export const createOrgComment = async (
  orgId: string,
  userId: string,
  postId: string,
  input: CreateOrgCommentInput
) => {
  await requireActiveOrgMember(orgId, userId);
  const post = await requireOrgPostInOrg(orgId, postId);

  let resolvedParentId: string | null = null;
  let parentAuthorId: string | null = null;

  if (input.parentId) {
    const parentComment = await prisma.orgFeedComment.findUnique({
      where: { id: input.parentId },
      select: { id: true, postId: true, parentId: true, authorId: true },
    });

    if (!parentComment || parentComment.postId !== postId) {
      throw new ApiError(404, 'Parent comment not found on this post');
    }

    // Flatten replies to 1 level deep (Teams / Slack thread style)
    resolvedParentId = parentComment.parentId ?? parentComment.id;
    parentAuthorId = parentComment.authorId;
  }

  const comment = await prisma.orgFeedComment.create({
    data: {
      postId,
      authorId: userId,
      parentId: resolvedParentId,
      content: input.content.trim(),
    },
    include: {
      author: { select: USER_PUBLIC_SELECT },
      _count: { select: { replies: true } },
    },
  });

  return {
    comment,
    postAuthorId: post.authorId,
    parentAuthorId,
  };
};

export const getOrgComments = async (
  orgId: string,
  userId: string,
  postId: string,
  cursor?: string | null,
  limit: number = 20
) => {
  await requireActiveOrgMember(orgId, userId);
  await requireOrgPostInOrg(orgId, postId);

  const take = Math.min(Math.max(limit || 20, 1), 50);

  if (cursor) {
    const cursorComment = await prisma.orgFeedComment.findFirst({
      where: { id: cursor, postId, parentId: null },
      select: { id: true },
    });
    if (!cursorComment) {
      throw new ApiError(400, 'Invalid pagination cursor for this post');
    }
  }

  const comments = await prisma.orgFeedComment.findMany({
    where: { postId, parentId: null },
    take: take + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      author: { select: USER_PUBLIC_SELECT },
      replies: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          author: { select: USER_PUBLIC_SELECT },
        },
      },
      _count: { select: { replies: true } },
    },
  });

  const hasNextPage = comments.length > take;
  const pagedComments = hasNextPage ? comments.slice(0, take) : comments;
  const nextCursor =
    hasNextPage && pagedComments.length > 0 ? pagedComments[pagedComments.length - 1].id : null;

  return {
    comments: pagedComments,
    nextCursor,
    hasNextPage,
  };
};

export const updateOrgComment = async (
  orgId: string,
  userId: string,
  postId: string,
  commentId: string,
  input: UpdateOrgCommentInput
) => {
  await requireActiveOrgMember(orgId, userId);
  await requireOrgPostInOrg(orgId, postId);

  const existing = await prisma.orgFeedComment.findUnique({
    where: { id: commentId },
  });

  if (!existing || existing.postId !== postId) {
    throw new ApiError(404, 'Comment not found on this post');
  }

  if (existing.authorId !== userId) {
    throw new ApiError(403, 'You can only edit your own comments');
  }

  return await prisma.orgFeedComment.update({
    where: { id: commentId },
    data: {
      content: input.content.trim(),
      isEdited: true,
      editedAt: new Date(),
    },
    include: {
      author: { select: USER_PUBLIC_SELECT },
      _count: { select: { replies: true } },
    },
  });
};

export const deleteOrgComment = async (
  orgId: string,
  userId: string,
  postId: string,
  commentId: string
) => {
  const membership = await requireActiveOrgMember(orgId, userId);
  await requireOrgPostInOrg(orgId, postId);

  const existing = await prisma.orgFeedComment.findUnique({
    where: { id: commentId },
  });

  if (!existing || existing.postId !== postId) {
    throw new ApiError(404, 'Comment not found on this post');
  }

  if (existing.authorId !== userId && !isOrgModerator(membership.role)) {
    throw new ApiError(403, 'You do not have permission to delete this comment');
  }

  await prisma.orgFeedComment.delete({
    where: { id: commentId },
  });

  return {
    deleted: true,
    commentId,
    postId,
    parentId: existing.parentId,
  };
};