import { Router } from 'express';
import { OrgRole } from '@prisma/client';
import {
  createOrganizationController,
  getUserOrganizationsController,
  getOrganizationController,
  updateOrganizationController,
} from '../controllers/organizationController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { requireOrgMember } from '../middlewares/orgAuthMiddleware.js';

const router = Router();

router.post('/', authMiddleware, createOrganizationController);
router.get('/', authMiddleware, getUserOrganizationsController);

router.get('/:id', authMiddleware, requireOrgMember(), getOrganizationController);
router.patch(
  '/:id',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  updateOrganizationController
);

export default router;
