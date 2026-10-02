import { Router } from 'express';
import { optionalAuth } from '../middlewares/authMiddleware';
import { otpLimiter } from '../middlewares/rateLimiter';
import {
  sendVerificationOTP,
  verifyEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/otpController';

const router = Router();

router.post('/send-verification', otpLimiter, optionalAuth, sendVerificationOTP);
router.post('/verify-email', otpLimiter, optionalAuth, verifyEmail);
router.post('/forgot-password', otpLimiter, forgotPassword);
router.post('/reset-password', otpLimiter,resetPassword);

export default router;
