import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createTeam,
  getOrganizationTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
} from '../services/teamService.js';

// Safe helper to extract string from Express req.params
const getParam = (param: unknown): string => {
  if (typeof param === 'string') return param.trim();
  if (Array.isArray(param) && typeof param[0] === 'string') return param[0].trim();
  return String(param || '').trim();
};

export const createTeamController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const orgId = getParam(req.params.id);
    const { name, description } = req.body;

    const team = await createTeam(orgId, req.user.id, {
      name,
      description,
    });

    return res.status(201).json({
      success: true,
      data: team,
    });
  }
);

export const getOrganizationTeamsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teams = await getOrganizationTeams(orgId);

    return res.status(200).json({
      success: true,
      data: teams,
    });
  }
);

export const getTeamController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);

    const team = await getTeamById(orgId, teamId);

    return res.status(200).json({
      success: true,
      data: team,
    });
  }
);

export const updateTeamController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);
    const { name, description } = req.body;

    const updated = await updateTeam(orgId, teamId, {
      name,
      description,
    });

    return res.status(200).json({
      success: true,
      data: updated,
    });
  }
);

export const deleteTeamController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);

    const result = await deleteTeam(orgId, teamId);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  }
);

export const addTeamMemberController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);
    const { userId, role } = req.body;

    if (!userId) {
      return next(new ApiError(400, 'userId is required'));
    }

    const member = await addTeamMember(orgId, teamId, String(userId).trim(), role);

    return res.status(201).json({
      success: true,
      data: member,
    });
  }
);

export const removeTeamMemberController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);
    const userId = getParam(req.params.userId);

    const result = await removeTeamMember(orgId, teamId, userId);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  }
);
