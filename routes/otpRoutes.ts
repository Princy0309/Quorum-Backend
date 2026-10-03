import { Router } from 'express';
import { optionalAuth } from '../middlewares/authMiddleware';
import { otpLimiter } from '../middlewares/rateLimiter';
import { validate } from '../middlewares/validate';
import { verifyEmailSchema, sendResetSchema, resetPasswordSchema } from '../validators/otpValidators';
import {
  sendVerificationOTP,
  verifyEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/otpController';

const router = Router();

router.post('/send-verification', otpLimiter, optionalAuth, sendVerificationOTP);
router.post('/verify-email', otpLimiter, optionalAuth, validate(verifyEmailSchema), verifyEmail);
router.post('/forgot-password', otpLimiter, validate(sendResetSchema), forgotPassword);
router.post('/reset-password', otpLimiter, validate(resetPasswordSchema), resetPassword);

export default router;
