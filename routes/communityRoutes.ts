import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validateJoi } from '../middlewares/validate.js';
import {
  createCommunitySchema,
  updateCommunitySchema
} from '../validators/communityValidators.js';
import {
  createCommunityController,
  getUserCommunitiesController,
  getCommunityDetailsController,
  updateCommunityController,
  deleteCommunityController
} from '../controllers/communityController.js';

const router = Router();

router.post('/', authMiddleware, validateJoi(createCommunitySchema), createCommunityController);
router.get('/', authMiddleware, getUserCommunitiesController);
router.get('/:id', authMiddleware, getCommunityDetailsController);
router.patch('/:id', authMiddleware, validateJoi(updateCommunitySchema), updateCommunityController);
router.delete('/:id', authMiddleware, deleteCommunityController);

export default router;
