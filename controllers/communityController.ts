import { Request, Response, NextFunction } from 'express';
import {
  createCommunity,
  getUserCommunities,
  getCommunityDetails,
  updateCommunity,
  deleteCommunity,
  createInviteLink,
  validateInviteToken,
  joinCommunityViaInvite,
  revokeInviteLink,
  searchUsersToInvite,
  listCommunityMembers,
  leaveCommunity,
  removeCommunityMember,
  changeMemberRole,
  transferCommunityOwnership
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
    const inviteId = validateCommunityId(req.params.inviteId);

    const result = await revokeInviteLink(userId, id, inviteId);
    res.status(200).json({
      success: true,
      data: result
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
      data: result
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


