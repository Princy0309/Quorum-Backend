import { Router } from 'express';
import { registerLimiter, loginLimiter, refreshLimiter } from '../middlewares/rateLimiter';
import { register, login, refreshToken, logout, logoutAll, getMe } from '../controllers/authController';
import { authMiddleware, requireEmailVerified } from '../middlewares/authMiddleware';

const router = Router();

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/refresh-token', refreshLimiter, refreshToken);
router.post('/logout', logout);
router.post('/logout-all', authMiddleware, logoutAll);
router.get('/me', authMiddleware, requireEmailVerified, getMe);

export default router;
