const express = require('express');
const { loginLimiter, refreshLimiter } = require('../middlewares/rateLimiter');
const { register, login, refreshToken, logout, getMe } = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/register', loginLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/refresh-token', refreshLimiter, refreshToken);
router.post('/logout', logout);
router.get('/me', authMiddleware, getMe);

module.exports = router;
