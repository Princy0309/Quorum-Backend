const express = require('express');
const { authLimiter } = require('../middlewares/rateLimiter');
const { register, login, refreshToken, logout, getMe } = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/refresh-token', authLimiter, refreshToken);
router.post('/logout', logout);
router.get('/me', authMiddleware, getMe);

module.exports = router;
