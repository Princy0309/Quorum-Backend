import { Router } from 'express';
import { optionalAuth } from '../middlewares/authMiddleware';
import {
  sendVerificationOTP,
  verifyEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/otpController';

const router = Router();

router.post('/send-verification', optionalAuth, sendVerificationOTP);
router.post('/verify-email', optionalAuth, verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
