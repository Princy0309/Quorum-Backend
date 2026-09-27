const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const {
    sendVerificationOTP,
    verifyEmail,
    forgotPassword,
    resetPassword,
} = require('../controllers/otpController')

router.post('/send-verification', authMiddleware, sendVerificationOTP);
router.post('/verify-email', authMiddleware, verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
