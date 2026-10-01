const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const { otpLimiter } = require('../middlewares/rateLimiter');
const {
    sendVerificationOTP,
    verifyEmail,
    forgotPassword,
    resetPassword,
} = require('../controllers/otpController');

router.post('/send-verification', authMiddleware, otpLimiter, sendVerificationOTP);
router.post('/verify-email', authMiddleware, otpLimiter, verifyEmail);
router.post('/forgot-password', otpLimiter, forgotPassword);
router.post('/reset-password', otpLimiter, resetPassword);

module.exports = router;
