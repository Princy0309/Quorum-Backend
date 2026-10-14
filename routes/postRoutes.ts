import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validateJoi } from '../middlewares/validate.js';
import {
  updatePostSchema,
  createCommentSchema
} from '../validators/postValidators.js';
import {
  updatePostController,
  deletePostController,
  getCommunityFeedController
} from '../controllers/postController.js';
import {
  createCommentController,
  getPostCommentsController
} from '../controllers/commentController.js';

const router = Router();

router.get('/feed', authMiddleware, getCommunityFeedController);
router.get('/', authMiddleware, getCommunityFeedController);

router.post('/:postId/comments', authMiddleware, validateJoi(createCommentSchema), createCommentController);
router.get('/:postId/comments', authMiddleware, getPostCommentsController);

router.patch('/:postId', authMiddleware, validateJoi(updatePostSchema), updatePostController);
router.delete('/:postId', authMiddleware, deletePostController);

export default router;
