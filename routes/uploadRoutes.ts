import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { signUploadController, directS3UploadController, uploadMiddleware } from '../controllers/uploadController.js';

const router = Router();

router.post('/sign', authMiddleware, signUploadController);
router.post('/s3', uploadMiddleware, directS3UploadController);

export default router;

