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
import { getIO } from '../sockets/socketServer.js';
import { ORG_FEED_EVENTS } from '../utils/constants.js';
import { queueNotification } from '../queues/notificationQueue.js';

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

const emitOrgFeedEvent = (orgId: string, event: string, payload: Record<string, any>) => {
    try {
        const io = getIO();
        io.to(`org:${orgId}`).emit(event, payload);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug(`[OrgFeedSocket] Skipped ${event} emit: ${msg}`);
    }
};

const getPostPreview = (post: any): string => {
    const raw = (post.title || post.content || 'Shared a new post').trim();
    return raw.length > 90 ? `${raw.slice(0, 90)}...` : raw;
};

const buildOrgPostCopy = (post: any, actorName: string, preview: string) => {
    const category = post.category as OrgPostCategory;
    const teamName = post.targetTeam?.name as string | undefined;
    const targetName = post.targetUser?.name as string | undefined;
    const isMilestone = category === OrgPostCategory.MILESTONE;

    const teamMessage = teamName
        ? {
            title: isMilestone
                ? `Your team ${teamName} was appreciated!`
                : `Your team ${teamName} was mentioned`,
            body: isMilestone
                ? `${actorName} recognized ${teamName} in the organization feed: "${preview}"`
                : `${actorName} mentioned ${teamName}: "${preview}"`,
        }
        : null;

    let targetUserMessage: { title: string; body: string } | null = null;
    if (targetName) {
        if (category === OrgPostCategory.BIRTHDAY) {
            targetUserMessage = {
                title: `Happy Birthday, ${targetName}!`,
                body: `${actorName} wished you a Happy Birthday in the organization feed: "${preview}"`,
            };
        } else if (category === OrgPostCategory.PROMOTION) {
            targetUserMessage = {
                title: 'Congratulations on your promotion!',
                body: `${actorName} shared your promotion in the organization feed: "${preview}"`,
            };
        } else if (category === OrgPostCategory.WELCOME) {
            targetUserMessage = {
                title: 'Welcome to the organization!',
                body: `${actorName} welcomed you in the organization feed: "${preview}"`,
            };
        } else {
            targetUserMessage = {
                title: `You were appreciated by ${actorName}!`,
                body: `${actorName} recognized you in the organization feed: "${preview}"`,
            };
        }
    }

    let orgMessage: { title: string; body: string };
    if (teamName) {
        orgMessage = {
            title: isMilestone ? `${teamName} reached a milestone!` : `${teamName} was highlighted`,
            body: isMilestone
                ? `${actorName} appreciated ${teamName}: "${preview}" — send them kudos!`
                : `${actorName} gave a shoutout to ${teamName}: "${preview}"`,
        };
    } else if (targetName) {
        if (category === OrgPostCategory.BIRTHDAY) {
            orgMessage = {
                title: `It's ${targetName}'s Birthday!`,
                body: `${actorName} wished ${targetName} — join in and wish them!`,
            };
        } else if (category === OrgPostCategory.PROMOTION) {
            orgMessage = {
                title: `${targetName} got promoted!`,
                body: `${actorName} celebrated ${targetName}'s promotion: "${preview}"`,
            };
        } else if (category === OrgPostCategory.WELCOME) {
            orgMessage = {
                title: `Welcome ${targetName} to the team!`,
                body: `${actorName} welcomed ${targetName} — say hello in the feed!`,
            };
        } else {
            orgMessage = {
                title: `${targetName} was appreciated by ${actorName}`,
                body: `${actorName} gave a shoutout to ${targetName}: "${preview}"`,
            };
        }
    } else if (category === OrgPostCategory.FESTIVAL) {
        orgMessage = {
            title: post.title || 'Organization Celebration',
            body: `${actorName}: "${preview}"`,
        };
    } else if (category === OrgPostCategory.ANNOUNCEMENT) {
        orgMessage = {
            title: post.title || 'New Organization Announcement',
            body: `${actorName}: "${preview}"`,
        };
    } else {
        orgMessage = {
            title: post.title || `${actorName} posted in the organization feed`,
            body: preview,
        };
    }

    return { teamMessage, targetUserMessage, orgMessage };
};

const notifyOrgFeedPostRecipients = async (orgId: string, post: any, actorId: string | null) => {
    try {
        const actorName = post.author?.name || 'Organization Admin';
        const preview = getPostPreview(post);
        const { teamMessage, targetUserMessage, orgMessage } = buildOrgPostCopy(post, actorName, preview);

        const recipients = new Map<string, { title: string; body: string; audience: string }>();

        // Priority 1: Specific honored / celebrated user
        if (post.targetUserId && targetUserMessage) {
            recipients.set(post.targetUserId, { ...targetUserMessage, audience: 'target_user' });
        }

        // Priority 2: Members of the highlighted team
        if (post.targetTeamId && teamMessage) {
            const teamMembers = await prisma.teamMember.findMany({
                where: { teamId: post.targetTeamId },
                select: { userId: true },
            });
            for (const tm of teamMembers) {
                if (!recipients.has(tm.userId)) {
                    recipients.set(tm.userId, { ...teamMessage, audience: 'target_team' });
                }
            }
        }

        // Priority 3: Directly @mentioned users
        if (Array.isArray(post.mentionedUserIds)) {
            for (const mentionedId of post.mentionedUserIds) {
                if (!recipients.has(mentionedId)) {
                    recipients.set(mentionedId, {
                        title: `${actorName} mentioned you in an organization post`,
                        body: preview,
                        audience: 'mentioned',
                    });
                }
            }
        }

        // Priority 4: Rest of the organization (for celebrations, announcements, or targeted shoutouts)
        const shouldBroadcastOrgWide =
            post.category !== OrgPostCategory.GENERAL ||
            Boolean(post.targetTeamId) ||
            Boolean(post.targetUserId);

        if (shouldBroadcastOrgWide) {
            const orgMembers = await prisma.organizationMember.findMany({
                where: { organizationId: orgId },
                select: { userId: true },
            });
            for (const member of orgMembers) {
                if (!recipients.has(member.userId)) {
                    recipients.set(member.userId, { ...orgMessage, audience: 'organization' });
                }
            }
        }

        if (actorId) {
            recipients.delete(actorId);
        }

        if (recipients.size === 0) return;

        await Promise.allSettled(
            Array.from(recipients.entries()).map(([recipientId, meta]) =>
                queueNotification({
                    recipientId,
                    actorId: actorId || undefined,
                    type: 'ORG_FEED_POST',
                    title: meta.title,
                    body: meta.body,
                    data: {
                        organizationId: orgId,
                        postId: post.id,
                        category: post.category,
                        audience: meta.audience,
                        targetTeamId: post.targetTeamId || null,
                        targetUserId: post.targetUserId || null,
                    },
                })
            )
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[OrgFeedNotification] Failed to queue post notifications: ${msg}`);
    }
};

const notifyOrgCommentRecipients = async (
    orgId: string,
    postId: string,
    comment: any,
    authorId: string,
    postAuthorId: string | null,
    parentAuthorId: string | null
) => {
    try {
        const commenterName = comment.author?.name || 'A teammate';
        const preview = comment.content.trim().slice(0, 60);
        const suffix = comment.content.trim().length > 60 ? '...' : '';
        const recipients = new Map<string, { title: string; body: string }>();

        if (postAuthorId && postAuthorId !== authorId) {
            recipients.set(postAuthorId, {
                title: 'New comment on your organization post',
                body: `${commenterName}: "${preview}${suffix}"`,
            });
        }

        if (parentAuthorId && parentAuthorId !== authorId) {
            recipients.set(parentAuthorId, {
                title: 'New reply to your comment',
                body: `${commenterName} replied: "${preview}${suffix}"`,
            });
        }

        await Promise.allSettled(
            Array.from(recipients.entries()).map(([recipientId, meta]) =>
                queueNotification({
                    recipientId,
                    actorId: authorId,
                    type: 'ORG_FEED_COMMENT',
                    title: meta.title,
                    body: meta.body,
                    data: {
                        organizationId: orgId,
                        postId,
                        commentId: comment.id,
                    },
                })
            )
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[OrgFeedNotification] Failed to queue comment notifications: ${msg}`);
    }
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
    const formatted = formatOrgFeedPost(post, userId);
    emitOrgFeedEvent(orgId, ORG_FEED_EVENTS.POST_NEW, { organizationId: orgId, post: formatted });
    void notifyOrgFeedPostRecipients(orgId, post, userId);
    return formatted;
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

    const broadcastPost = formatOrgFeedPost(updated, '');
    emitOrgFeedEvent(orgId, ORG_FEED_EVENTS.POST_UPDATED, { organizationId: orgId, post: broadcastPost });
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
    emitOrgFeedEvent(orgId, ORG_FEED_EVENTS.POST_DELETED, { organizationId: orgId, postId });
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

    const broadcastPost = formatOrgFeedPost(updated, '');
    emitOrgFeedEvent(orgId, ORG_FEED_EVENTS.POST_PINNED, { organizationId: orgId, post: broadcastPost });
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

    emitOrgFeedEvent(orgId, ORG_FEED_EVENTS.REACTION_UPDATED, {
        organizationId: orgId,
        postId,
        actorId: userId,
        emoji: cleanEmoji,
        action,
        reactions: formatReactions(allReactions, ''),
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

    emitOrgFeedEvent(orgId, ORG_FEED_EVENTS.COMMENT_NEW, { organizationId: orgId, postId, comment });
    void notifyOrgCommentRecipients(orgId, postId, comment, userId, post.authorId, parentAuthorId);

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

    const updated = await prisma.orgFeedComment.update({
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

    emitOrgFeedEvent(orgId, ORG_FEED_EVENTS.COMMENT_UPDATED, { organizationId: orgId, postId, comment: updated });
    return updated;
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

    emitOrgFeedEvent(orgId, ORG_FEED_EVENTS.COMMENT_DELETED, {
        organizationId: orgId,
        postId,
        commentId,
        parentId: existing.parentId,
    });

    return {
        deleted: true,
        commentId,
        postId,
        parentId: existing.parentId,
    };
};

export interface SystemOrgPostInput {
    organizationId: string;
    category: OrgPostCategory;
    title?: string;
    content: string;
    actorId?: string | null;
    targetUserId?: string | null;
    targetTeamId?: string | null;
}

export const createSystemOrgFeedPost = async (input: SystemOrgPostInput) => {
    try {
        const post = await prisma.orgFeedPost.create({
            data: {
                organizationId: input.organizationId,
                authorId: input.actorId || null,
                category: input.category,
                title: input.title?.trim() || null,
                content: input.content.trim(),
                targetUserId: input.targetUserId || null,
                targetTeamId: input.targetTeamId || null,
                isSystemGenerated: true,
            },
            include: ORG_POST_INCLUDE,
        });

        const formatted = formatOrgFeedPost(post, '');
        emitOrgFeedEvent(input.organizationId, ORG_FEED_EVENTS.POST_NEW, {
            organizationId: input.organizationId,
            post: formatted,
        });
        void notifyOrgFeedPostRecipients(input.organizationId, post, input.actorId || null);

        return formatted;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[OrgFeedSystemPost] Failed to auto-create ${input.category} post: ${msg}`);
        return null;
    }
};