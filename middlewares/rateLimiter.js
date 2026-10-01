const { RateLimiterRedis } = require('rate-limiter-flexible');
const redisClient = require('../config/redis');

const loginRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'login',
  points: 10,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

const refreshRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'refresh',
  points: 15,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

const registerRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'register',
  points: 10,
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

const loginLimiter = async (req, res, next) => {
  try {
    const status = await loginRateLimiter.get(req.ip);
    if (status && status.remainingPoints <= 0) {
      return res.status(429).json({ success: false, message: 'Too many failed login attempts, try again after 15 minutes.' });
    }
    next();
  } catch (err) {
    next();
  }
};

const refreshLimiter = (req, res, next) => {
  refreshRateLimiter.consume(req.ip)
    .then(() => next())
    .catch((err) => {
      if (err instanceof Error) {
        return next();
      }
      res.status(429).json({ success: false, message: 'Too many refresh token requests, try again later.' });
    });
};

const registerLimiter = (req, res, next) => {
  registerRateLimiter.consume(req.ip)
    .then(() => next())
    .catch((err) => {
      if (err instanceof Error) {
        return next();
      }
      res.status(429).json({ success: false, message: 'Too many registration attempts, try again later.' });
    });
};

const otpRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'otp',
  points: 5,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

const otpLimiter = (req, res, next) => {
  otpRateLimiter.consume(req.ip)
    .then(() => next())
    .catch((err) => {
      if (err instanceof Error) {
        return next();
      }
      res.status(429).json({ success: false, message: 'Too many OTP requests, try again after 15 minutes.' });
    });
};

module.exports = { loginLimiter, refreshLimiter, registerLimiter, loginRateLimiter, otpLimiter };

