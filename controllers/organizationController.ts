import { Request, Response, NextFunction } from 'express';
import {asyncHandler} from '../utils/asyncHandler.js';
import {ApiError} from '../utils/ApiError.js';
import {
  createOrganization,
  getUserOrganizations,
  getOrganizationById,
  updateOrganization,
} from '../services/organizationService.js';

export const createOrganizationController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const {name, description, logo} = req.body;

    const organization = await createOrganization(req.user.id, {
      name,
      description,
      logo,
    });

    return res.status(201).json({
      success: true,
      data: organization,
    });
  }
);

export const getUserOrganizationsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const organizations = await getUserOrganizations(req.user.id);

    return res.status(200).json({
      success: true,
      data: organizations,
    });
  }
);

export const getOrganizationController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.orgId || req.params.id;
    const orgId = typeof rawId === 'string' ? rawId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const organization = await getOrganizationById(orgId);

    return res.status(200).json({
      success: true,
      data: organization,
    });
  }
);

export const updateOrganizationController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.orgId || req.params.id;
    const orgId = typeof rawId === 'string' ? rawId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const { name, description, logo } = req.body;

    const updatedOrg = await updateOrganization(orgId, {
      name,
      description,
      logo,
    });

    return res.status(200).json({
      success: true,
      data: updatedOrg,
    });
  }
);

