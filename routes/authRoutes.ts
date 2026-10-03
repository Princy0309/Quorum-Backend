import { Router } from 'express';
import { registerLimiter, loginLimiter, refreshLimiter } from '../middlewares/rateLimiter.js';
import { register, login, refreshToken, logout, logoutAll, getMe } from '../controllers/authController.js';
import { authMiddleware, requireEmailVerified } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { registerSchema, loginSchema } from '../validators/authValidators.js';

const router = Router();

router.post('/register', registerLimiter, validate(registerSchema), register);
router.post('/login', loginLimiter, validate(loginSchema), login);
router.post('/refresh-token', refreshLimiter, refreshToken);
router.post('/logout', logout);
router.post('/logout-all', authMiddleware, logoutAll);
router.get('/me', authMiddleware, requireEmailVerified, getMe);

export default router;
