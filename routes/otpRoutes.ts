import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  sendVerificationOTP,
  verifyEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/otpController';

const router = Router();

router.post('/send-verification', authMiddleware, sendVerificationOTP);
router.post('/verify-email', authMiddleware, verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
