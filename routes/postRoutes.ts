import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validateJoi } from '../middlewares/validate.js';
import { updatePostSchema } from '../validators/postValidators.js';
import {
  updatePostController,
  deletePostController
} from '../controllers/postController.js';

const router = Router();

router.patch('/:postId', authMiddleware, validateJoi(updatePostSchema), updatePostController);
router.delete('/:postId', authMiddleware, deletePostController);

export default router;
