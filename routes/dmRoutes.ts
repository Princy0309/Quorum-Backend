import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { createOrGetDMController } from '../controllers/dmController.js';

const router = Router();

router.post('/', authMiddleware, createOrGetDMController);

export default router;
