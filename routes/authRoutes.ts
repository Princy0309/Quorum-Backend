import { Router } from 'express';
import { registerLimiter, loginLimiter, refreshLimiter } from '../middlewares/rateLimiter';
import { register, login, googleAuth, refreshToken, logout, getMe } from '../controllers/authController';
import { generate2FASecret, enable2FA, verify2FALogin } from '../controllers/twoFactorController';
import { authMiddleware, requireEmailVerified } from '../middlewares/authMiddleware';

const router = Router();

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/google', loginLimiter, googleAuth);
router.post('/2fa/generate', authMiddleware, generate2FASecret);
router.post('/2fa/enable', authMiddleware, enable2FA);
router.post('/2fa/verify-login', loginLimiter, verify2FALogin);
router.post('/refresh-token', refreshLimiter, refreshToken);
router.post('/logout', logout);
router.get('/me', authMiddleware, requireEmailVerified, getMe);

export default router;
