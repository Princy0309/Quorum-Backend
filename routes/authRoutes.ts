import { Router } from 'express';
import { registerLimiter, loginLimiter, refreshLimiter } from '../middlewares/rateLimiter';
import { register, login, googleAuth, refreshToken, logout, getMe } from '../controllers/authController';
import { authMiddleware, requireEmailVerified } from '../middlewares/authMiddleware';


const router = Router();

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/google', loginLimiter, googleAuth);
router.post('/refresh-token', refreshLimiter, refreshToken);
router.post('/logout', logout);
router.get('/me', authMiddleware, requireEmailVerified, getMe);


export default router;
