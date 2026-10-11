import { Router } from 'express';
import {
  createOrganizationController,
  getUserOrganizationsController,
} from '../controllers/organizationController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/', authMiddleware, createOrganizationController);
router.get('/', authMiddleware, getUserOrganizationsController);

export default router;
