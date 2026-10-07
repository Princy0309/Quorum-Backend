import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { signUploadController } from '../controllers/uploadController.js';

const router = Router();

router.post('/sign', authMiddleware, signUploadController);

export default router;
