import { Router } from 'express';
import { registerLimiter, loginLimiter, refreshLimiter } from '../middlewares/rateLimiter';
import { register, login, refreshToken, logout, logoutAll, getMe } from '../controllers/authController';
import { authMiddleware, requireEmailVerified } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate';
import { registerSchema, loginSchema } from '../validators/authValidators';

const router = Router();

router.post('/register', registerLimiter, validate(registerSchema), register);
router.post('/login', loginLimiter, validate(loginSchema), login);
router.post('/refresh-token', refreshLimiter, refreshToken);
router.post('/logout', logout);
router.post('/logout-all', authMiddleware, logoutAll);
router.get('/me', authMiddleware, requireEmailVerified, getMe);

export default router;
