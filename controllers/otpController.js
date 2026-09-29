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
        const { code, codeHash } = generateOTP();

        await redis.set(
            `otp:verify:${user.id}`,
            JSON.stringify({ codeHash, attempts: 0 }),
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

    const { otp } = req.body;
    const user = req.user;

    try {
        const raw = await redis.get(`otp:verify:${user.id}`);
        if (!raw) {
            return sendError(res, 400, 'OTP expired or not found. Please request a new one.');
        }

        const { codeHash: storedHash, attempts } = JSON.parse(raw);

        if (attempts >= 5) {
            await redis.del(`otp:verify:${user.id}`);
            return sendError(res, 400, 'Too many failed attempts.Please request a new OTP.');
        }

        if (hashToken(otp) !== storedHash) {
            await redis.set(
                `otp:verify:${user.id}`,
                JSON.stringify({ codeHash: storedHash, attempts: attempts + 1 }),
                'EX',
                OTP_TTL_SECONDS
            )
            return sendError(res, 400, `Incorrect OTP. You have ${4 - attempts} attempts remaining`)
        }
        await redis.del(`otp:verify:${user.id}`);

        await prisma.user.update({
            where: { id: user.id },
            data: { isEmailVerified: true }
        });

        return sendSuccess(res, 200, 'Email verified successfully');
    }catch(error){
        console.error('Error veryfying email OTP: ', error);
        return sendError(res, 500, 'Internal Server Error');
    }

};


const forgotPassword = async (req, res) => {
    const result = sendResetSchema.validate(req.body);
    const error = result.error;
    if(error){
        return sendError(res, 400, error.details[0].message);
    }

    const {email} = req.body;

    try{
        const user = await prisma.user.findUnique({where: {email}});
        if(!user){
            return sendError(res, 404, 'User not found with this email address');

        }
         const {code, codeHash} = generateOTP();

            await redis.set(
                `otp:reset:${user.id}`,
                JSON.stringify({codeHash, attempts: 0}),
                'EX',
                OTP_TTL_SECONDS
            );

            await sendOTPEmail(user.email, code, 'reset');

            return sendSuccess(res, 200, 'Password reset OTP sent to your email');
    }catch(error){
        console.error('Error sending password reset OTP: ', error);
        return sendError(res, 500, 'Internet Server ErrorS')
    }
}

const resetPassword = async (req, res) => {
    const result = resetPasswordSchema.validate(req.body);
    const error = result.error;
    if (error) {
        return sendError(res, 400, error.details[0].message);
    }

    const { email, otp, newPassword } = req.body;

    try {
        const user = await prisma.user.findUnique({ where: { email } });
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

        if (hashToken(otp) !== storedHash) {
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
