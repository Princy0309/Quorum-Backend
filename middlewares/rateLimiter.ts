import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import redisClient from '../config/redis';

export const loginRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'login_v2',
  points: 50,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

export const refreshRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'refresh_v2',
  points: 50,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

export const registerRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'register_v2',
  points: 50,
  duration: 60 * 60,
  blockDuration: 15 * 60,
});

export const loginLimiter = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const status = await loginRateLimiter.get(req.ip || '127.0.0.1');
    if (status && status.remainingPoints <= 0) {
      return res.status(429).json({ success: false, statusCode: 429, message: 'Too many failed login attempts, try again after 15 minutes.' });
    }
    next();
  } catch (err) {
    next();
  }
};

export const refreshLimiter = (req: Request, res: Response, next: NextFunction): void => {
  refreshRateLimiter.consume(req.ip || '127.0.0.1')
    .then(() => next())
    .catch((err) => {
      if (err instanceof Error) {
        return next();
      }
      res.status(429).json({ success: false, statusCode: 429, message: 'Too many refresh token requests, try again later.' });
    });
};

export const registerLimiter = (req: Request, res: Response, next: NextFunction): void => {
  registerRateLimiter.consume(req.ip || '127.0.0.1')
    .then(() => next())
    .catch((err) => {
      if (err instanceof Error) {
        return next();
      }
      res.status(429).json({ success: false, statusCode: 429, message: 'Too many registration attempts, try again later.' });
    });
};

export const otpRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'otp_v2',
  points: 30,
  duration: 15 * 60,
  blockDuration: 5 * 60,
});

export const otpLimiter = (req: Request, res: Response, next: NextFunction): void => {
  otpRateLimiter.consume(req.ip || '127.0.0.1')
    .then(() => next())
    .catch((err) => {
      if (err instanceof Error) {
        return next();
      }
      res.status(429).json({ success: false, statusCode: 429, message: 'Too many OTP requests, try again after 15 minutes.' });
    });
};
