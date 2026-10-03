import { Router } from 'express';
import { optionalAuth } from '../middlewares/authMiddleware.js';
import { otpLimiter } from '../middlewares/rateLimiter.js';
import { validate } from '../middlewares/validate.js';
import { verifyEmailSchema, sendResetSchema, resetPasswordSchema } from '../validators/otpValidators.js';
import {
  sendVerificationOTP,
  verifyEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/otpController.js';

const router = Router();

router.post('/send-verification', otpLimiter, optionalAuth, sendVerificationOTP);
router.post('/verify-email', otpLimiter, optionalAuth, validate(verifyEmailSchema), verifyEmail);
router.post('/forgot-password', otpLimiter, validate(sendResetSchema), forgotPassword);
router.post('/reset-password', otpLimiter, validate(resetPasswordSchema), resetPassword);

export default router;
