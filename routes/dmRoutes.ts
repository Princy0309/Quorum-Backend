import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { chatLimiter } from '../middlewares/rateLimiter.js';
import { createOrGetDMController } from '../controllers/dmController.js';

const router = Router();

router.post('/', authMiddleware, chatLimiter, createOrGetDMController);

export default router;

