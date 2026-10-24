import { Request, Response, NextFunction } from 'express';
import {
  createCommunity,
  getUserCommunities,
  searchCommunities,
  getCommunityDetails,
  updateCommunity,
  deleteCommunity,
  createInviteLink,
  inviteUserToCommunity,
  getCommunityInvites,
  getUserPendingCommunityInvites,
  respondToCommunityInvite,
  validateInviteToken,
  joinCommunityViaInvite,
  revokeInviteLink,
  searchUsersToInvite,
  listCommunityMembers,
  leaveCommunity,
  removeCommunityMember,
  changeMemberRole,
  transferCommunityOwnership,
  createCommunityChannel,
  getCommunityChannels,
  getCommunityChannelById,
  updateCommunityChannel,
  deleteCommunityChannel
} from '../services/communityService.js';
import { ApiError } from '../utils/ApiError.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validateCommunityId = (id: unknown): string => {
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
    throw new ApiError(400, 'Invalid community ID format');
  }
  return id.trim();
};

const validateUserId = (id: unknown): string => {
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
    throw new ApiError(400, 'Invalid user ID format');
  }
  return id.trim();
};

const validateChannelId = (id: unknown): string => {
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
    throw new ApiError(400, 'Invalid channel ID format');
  }
  return id.trim();
};

const validateInviteId = (id: unknown): string => {
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
    throw new ApiError(400, 'Invalid invite ID format');
  }
  return id.trim();
};

export const createCommunityController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const result = await createCommunity(userId, req.body);
    res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getUserCommunitiesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const result = await getUserCommunities(userId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const searchCommunitiesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const query = typeof req.query.q === 'string' ? req.query.q : (typeof req.query.search === 'string' ? req.query.search : '');
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit)
      ? parseInt(req.query.limit, 10)
      : 20;

    const result = await searchCommunities(userId, query, cursor, limit);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getCommunityDetailsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const result = await getCommunityDetails(userId, id);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const updateCommunityController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const result = await updateCommunity(userId, id, req.body);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const deleteCommunityController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const result = await deleteCommunity(userId, id);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const createInviteLinkController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const { expiresInDays } = req.body || {};

    const result = await createInviteLink(userId, id, expiresInDays);
    res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const validateInviteTokenController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new ApiError(400, 'Invalid invitation token');
    }

    const result = await validateInviteToken(token.trim());
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const joinCommunityViaInviteController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { token } = req.params;
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new ApiError(400, 'Invalid invitation token');
    }

    const result = await joinCommunityViaInvite(userId, token.trim());
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const revokeInviteLinkController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const inviteId = validateInviteId(req.params.inviteId);

    const result = await revokeInviteLink(userId, id, inviteId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const inviteUserToCommunityController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const body = req.body || {};
    const rawTargetUserId = body.invitedUserId || body.userId || body.targetUserId || body.inviteeId;
    const targetUserId = typeof rawTargetUserId === 'string' && rawTargetUserId.trim() ? rawTargetUserId.trim() : undefined;
    const rawEmail = body.email || body.invitedEmail;
    const email = typeof rawEmail === 'string' && rawEmail.trim() ? rawEmail.trim() : undefined;
    const role = body.role;

    let expiresInDays = body.expiresInDays;
    if (!expiresInDays && body.expiresInHours) {
      expiresInDays = Math.max(1, Math.ceil(body.expiresInHours / 24));
    }
    if (!expiresInDays) {
      expiresInDays = 7;
    }

    if (!targetUserId && !email) {
      const result = await createInviteLink(userId, id, expiresInDays);
      return res.status(201).json({
        success: true,
        data: result
      });
    }

    const result = await inviteUserToCommunity(userId, id, {
      userId: targetUserId,
      email,
      role,
      expiresInDays
    });

    res.status(201).json({
      success: true,
      data: result,
      message: 'Invitation sent successfully'
    });
  } catch (err) {
    next(err);
  }
};

export const getCommunityInvitesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const result = await getCommunityInvites(userId, id);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getUserPendingInvitesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const result = await getUserPendingCommunityInvites(userId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const respondToCommunityInviteController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const rawIdentifier = req.params.identifier || req.params.inviteId || req.params.token;
    if (!rawIdentifier || typeof rawIdentifier !== 'string' || rawIdentifier.trim().length === 0) {
      throw new ApiError(400, 'Invitation identifier is required');
    }

    const action = req.body?.action === 'decline' ? 'decline' : 'accept';
    const result = await respondToCommunityInvite(userId, rawIdentifier.trim(), action);
    res.status(200).json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    next(err);
  }
};

export const acceptCommunityInviteController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const rawIdentifier = req.params.identifier || req.params.inviteId || req.params.token;
    if (!rawIdentifier || typeof rawIdentifier !== 'string' || rawIdentifier.trim().length === 0) {
      throw new ApiError(400, 'Invitation identifier is required');
    }

    const result = await respondToCommunityInvite(userId, rawIdentifier.trim(), 'accept');
    res.status(200).json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    next(err);
  }
};

export const declineCommunityInviteController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const rawIdentifier = req.params.identifier || req.params.inviteId || req.params.token;
    if (!rawIdentifier || typeof rawIdentifier !== 'string' || rawIdentifier.trim().length === 0) {
      throw new ApiError(400, 'Invitation identifier is required');
    }

    const result = await respondToCommunityInvite(userId, rawIdentifier.trim(), 'decline');
    res.status(200).json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    next(err);
  }
};

export const searchUsersToInviteController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit)
      ? parseInt(req.query.limit, 10)
      : 20;

    const result = await searchUsersToInvite(userId, id, query, cursor, limit);
    res.status(200).json({
      success: true,
      data: result,
      users: result.users,
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage
    });
  } catch (err) {
    next(err);
  }
};

export const getCommunityMembersController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit)
      ? parseInt(req.query.limit, 10)
      : 20;

    const result = await listCommunityMembers(userId, id, cursor, limit);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const leaveCommunityController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const result = await leaveCommunity(userId, id);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const removeCommunityMemberController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const targetUserId = validateUserId(req.params.userId);

    const result = await removeCommunityMember(actorId, id, targetUserId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const changeMemberRoleController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const targetUserId = validateUserId(req.params.userId);
    const { role } = req.body;

    const result = await changeMemberRole(actorId, id, targetUserId, role);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const transferCommunityOwnershipController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const targetUserId = validateUserId(req.body.newOwnerId);

    const result = await transferCommunityOwnership(actorId, id, targetUserId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const createChannelController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const result = await createCommunityChannel(userId, id, req.body);
    res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getCommunityChannelsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const result = await getCommunityChannels(userId, id);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getChannelDetailsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const channelId = validateChannelId(req.params.channelId);
    const result = await getCommunityChannelById(userId, id, channelId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const updateChannelController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const channelId = validateChannelId(req.params.channelId);
    const result = await updateCommunityChannel(userId, id, channelId, req.body);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const deleteChannelController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const channelId = validateChannelId(req.params.channelId);
    const result = await deleteCommunityChannel(userId, id, channelId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};



