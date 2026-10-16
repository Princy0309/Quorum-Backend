import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { aiChatSchema } from '../validators/aiValidators.js';
import { chatController } from '../controllers/aiController.js';

const router = Router();

router.post('/chat', authMiddleware, validate(aiChatSchema), chatController);

export default router;
