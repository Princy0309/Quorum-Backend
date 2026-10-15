import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { updateCommentSchema } from '../validators/postValidators.js';
import {
  updateCommentController,
  deleteCommentController
} from '../controllers/commentController.js';

const router = Router();

router.patch('/:commentId', authMiddleware, validate(updateCommentSchema), updateCommentController);
router.delete('/:commentId', authMiddleware, deleteCommentController);

export default router;
