import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { uploadLimiterMiddleware } from '../middlewares/rateLimiter.js';
import { signUploadController, directS3UploadController, uploadMiddleware } from '../controllers/uploadController.js';

const router = Router();

router.post('/sign', authMiddleware, uploadLimiterMiddleware, signUploadController);
router.post('/s3', uploadLimiterMiddleware, uploadMiddleware, directS3UploadController);

export default router;

