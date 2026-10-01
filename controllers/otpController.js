const prisma = require('../config/prisma');
const redis = require('../config/redis');
const bcrypt = require('bcryptjs');
const { generateOTP } = require('../utils/generateOTP');
const { hashToken } = require('../utils/hashToken');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const { sendOTPEmail } = require('../services/emailService');
const {
    verifyEmailSchema,
    sendResetSchema,
    resetPasswordSchema,
} = require('../validators/otpValidators');

const OTP_TTL_SECONDS = 10 * 60;


const sendVerificationOTP = async (req, res) => {
    try {
        const user = req.user;
        const existing = await redis.get(`otp:verify:${user.id}`);
        
        if (existing) {
            const { createdAt } = JSON.parse(existing);
            if (createdAt && Date.now() - createdAt < 60 * 1000) {
                return sendSuccess(res, 200, 'Verification OTP already sent to your email');
            }
        }

        const { code, codeHash } = generateOTP();

        await redis.set(
            `otp:verify:${user.id}`,
            JSON.stringify({ codeHash, attempts: 0, createdAt: Date.now() }),
            'EX',
            OTP_TTL_SECONDS
        );

        await sendOTPEmail(user.email, code, 'verification');

        return sendSuccess(res, 200, 'Verification OTP sent to your email');
    } catch (error) {
        console.error('Error sending verification OTP: ', error);
        return sendError(res, 500, 'Internal Server Error');
    }
};

const verifyEmail = async (req, res) => {
    const result = verifyEmailSchema.validate(req.body);
    const error = result.error;
    if (error) {
        return sendError(res, 400, error.details[0].message);
    }

    const { otp, email } = req.body;
    const cleanOtp = String(otp || '').trim();

    try {
        let targetUser = req.user;
        if (email) {
            const found = await prisma.user.findUnique({ where: { email } });
            if (found) targetUser = found;
        }

        if (!targetUser) {
            return sendError(res, 400, 'User not found or missing authentication');
        }

        const raw = await redis.get(`otp:verify:${targetUser.id}`);
        if (!raw) {
            return sendError(res, 400, 'Invalid or expired verification code');
        }

        const { codeHash: storedHash, attempts } = JSON.parse(raw);

        if (attempts >= 5) {
            await redis.del(`otp:verify:${targetUser.id}`);
            return sendError(res, 400, 'Too many failed attempts. Please request a new OTP.');
        }

        if (hashToken(cleanOtp) !== storedHash) {
            await redis.set(
                `otp:verify:${targetUser.id}`,
                JSON.stringify({ codeHash: storedHash, attempts: attempts + 1 }),
                'EX',
                OTP_TTL_SECONDS
            );
            return sendError(res, 400, `Incorrect OTP. You have ${4 - attempts} attempts remaining`);
        }
        await redis.del(`otp:verify:${targetUser.id}`);

        await prisma.user.update({
            where: { id: targetUser.id },
            data: { isEmailVerified: true }
        });

        return sendSuccess(res, 200, 'Email verified successfully');
    } catch(error){
        console.error('Error verifying email OTP: ', error);
        return sendError(res, 500, 'Internal Server Error');
    }
};


const forgotPassword = async (req, res) => {
    const result = sendResetSchema.validate(req.body);
    const error = result.error;
    if(error){
        return sendError(res, 400, error.details[0].message);
    }

    const { email } = req.body;
    const cleanEmail = String(email || '').trim().toLowerCase();

    try {
        const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
        if(!user){
            return sendError(res, 404, 'User not found with this email address');
        }

        const { code, codeHash } = generateOTP();

        await redis.set(
            `otp:reset:${user.id}`,
            JSON.stringify({ codeHash, attempts: 0 }),
            'EX',
            OTP_TTL_SECONDS
        );

        await sendOTPEmail(user.email, code, 'reset');

        return sendSuccess(res, 200, 'Password reset OTP sent to your email');
    } catch(error){
        console.error('Error sending password reset OTP: ', error);
        return sendError(res, 500, 'Internal Server Error');
    }
};

const resetPassword = async (req, res) => {
    const result = resetPasswordSchema.validate(req.body);
    const error = result.error;
    if (error) {
        return sendError(res, 400, error.details[0].message);
    }

    const { email, otp, newPassword } = req.body;
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanOtp = String(otp || '').trim();

    try {
        const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
        if (!user) {
            return sendError(res, 404, 'User not found with this email address');
        }

        const raw = await redis.get(`otp:reset:${user.id}`);
        if (!raw) {
            return sendError(res, 400, 'Reset code expired or not found. Please request a new one.');
        }

        const { codeHash: storedHash, attempts } = JSON.parse(raw);

        if (attempts >= 5){
            await redis.del(`otp:reset:${user.id}`);
            return sendError(res, 400, 'Too many failed attempts. Please request a new code.');
        }

        if (hashToken(cleanOtp) !== storedHash) {
            await redis.set(
                `otp:reset:${user.id}`,
                JSON.stringify({ codeHash: storedHash, attempts: attempts + 1 }),
                'EX',
                OTP_TTL_SECONDS
            );
            return sendError(res, 400, `Incorrect code. You have ${4 - attempts} attempts remaining.`);
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash }
        });

        await redis.del(`otp:reset:${user.id}`);

        return sendSuccess(res, 200, 'Password reset successfully. Please log in with your new password.');
    } catch (error){
        console.error('Error resetting password:', error);
        return sendError(res, 500, 'Internal Server Error');
    }
};

module.exports = {
    sendVerificationOTP,
    verifyEmail,
    forgotPassword,
    resetPassword,
}
