const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { registerSchema, loginSchema } = require('../validators/authValidators');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const { issueTokens, rotateRefreshToken } = require('../services/tokenService');
const redis = require('../config/redis');
const { hashToken } = require('../utils/hashToken');
const { refreshCookieOptions } = require('../utils/cookieOptions');
const { loginRateLimiter } = require('../middlewares/rateLimiter');
const { generateOTP } = require('../utils/generateOTP');
const { sendOTPEmail } = require('../services/emailService');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const OTP_TTL_SECONDS = 10 * 60;

const register = async (req, res) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return sendError(res, 400, error.details[0].message);

  const { name, email, password } = value;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash }
    });

    const { code, codeHash } = generateOTP();
    await redis.set(
        `otp:verify:${user.id}`,
        JSON.stringify({ codeHash, attempts: 0 }),
        'EX',
        OTP_TTL_SECONDS
    );
    await sendOTPEmail(user.email, code, 'verification').catch(err => console.error(err));

    const { accessToken, refreshToken } = await issueTokens(user, req);
    const isMobile = req.headers['x-client-platform'] === 'mobile';

    if (isMobile) {
      return sendSuccess(res, 201, 'User registered successfully', { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } else {
      res.cookie('refreshToken', refreshToken, refreshCookieOptions);
      return sendSuccess(res, 201, 'User registered successfully', { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
    }
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'Email already registered');
    }
    console.error(err);
    return sendError(res, 500, 'Internal Server Error');
  }
};

const login = async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return sendError(res, 400, error.details[0].message);

  const { email, password } = value;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await loginRateLimiter.consume(req.ip).catch(() => {});
      return sendError(res, 401, 'Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await loginRateLimiter.consume(req.ip).catch(() => {});
      return sendError(res, 401, "Invalid credentials");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const { accessToken, refreshToken } = await issueTokens(user, req);
    const isMobile = req.headers['x-client-platform'] === 'mobile';

    if (isMobile) {
      return sendSuccess(res, 200, 'Login successful', { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } else {
      res.cookie('refreshToken', refreshToken, refreshCookieOptions);
      return sendSuccess(res, 200, 'Login successful', { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
    }
  } catch (err) {
    console.error(err);
    return sendError(res, 500, 'Internal Server Error');
  }
};

const refreshToken = async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) return sendError(res, 401, 'No refresh token provided');

  try {
    const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(token, req);
    const isMobile = req.headers['x-client-platform'] === 'mobile';

    if (isMobile) {
      return sendSuccess(res, 200, 'Token refreshed successfully', { accessToken, refreshToken: newRefreshToken });
    } else {
      res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);
      return sendSuccess(res, 200, 'Token refreshed successfully', { accessToken });
    }
  } catch (err) {
    if (err.status === 500) {
      console.error(err);
      return sendError(res, 500, 'Internal Server Error');
    }
    res.clearCookie('refreshToken');
    return sendError(res, 401, err.message);
  }
};

const logout = async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) return sendSuccess(res, 200, 'Logged out successfully');

  try {
    const tokenHash = hashToken(token);

    const raw = await redis.get(`refresh:${tokenHash}`);
    if (raw) {
      const { userId } = JSON.parse(raw);
      await redis.del(`refresh:${tokenHash}`);
      await redis.srem(`user_sessions:${userId}`, tokenHash);
    }

    res.clearCookie('refreshToken');
    return sendSuccess(res, 200, 'Logged out successfully');
  } catch (err) {
    console.error(err);
    return sendError(res, 500, 'Internal Server Error');
  }
};

const getMe = async (req, res) => {
  const user = { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, isEmailVerified: req.user.isEmailVerified, lastLogin: req.user.lastLogin };
  return sendSuccess(res, 200, 'User profile retrieved', user);
};

module.exports = { register, login, refreshToken, logout, getMe };