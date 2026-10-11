import { Request, Response, NextFunction } from 'express';
import {asyncHandler} from '../utils/asyncHandler.js';
import {ApiError} from '../utils/ApiError.js';
import {
  createOrganization,
  getUserOrganizations,
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
