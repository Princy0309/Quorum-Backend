import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import redisClient from '../config/redis';

import crypto from 'crypto';
import env from '../config/env';

export const loginIpRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'login_ip_v2',
  points: 20,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

export const loginAccountRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'login_account_v2',
  points: 10,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

export const hashEmail = (email: string) => {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(email.trim().toLowerCase()).digest('hex');
};

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
    const ip = req.ip || '127.0.0.1';
    await loginIpRateLimiter.consume(ip);

    const email = req.body?.email;
    if (email) {
      const emailHash = hashEmail(email);
      const status = await loginAccountRateLimiter.get(emailHash);
      if (status && status.remainingPoints <= 0) {
        return res.status(429).json({ success: false, statusCode: 429, message: 'Too many failed login attempts for this account, try again later.' });
      }
    }

    next();
  } catch (err: any) {
    if (err.remainingPoints !== undefined) {
      return res.status(429).json({ success: false, statusCode: 429, message: 'Too many login attempts from this IP, try again after 15 minutes.' });
    }
    next();
  }
};

export const refreshLimiter = (req: Request, res: Response, next: NextFunction): void => {
  refreshRateLimiter.consume(req.ip || '127.0.0.1')
    .then(() => next())
    .catch((err) => {
      if (err instanceof Error) {
        return res.status(500).json({ success: false, statusCode: 500, message: 'Internal Server Error' });
      }
      res.status(429).json({ success: false, statusCode: 429, message: 'Too many refresh token requests, try again later.' });
    });
};

export const registerLimiter = (req: Request, res: Response, next: NextFunction): void => {
  registerRateLimiter.consume(req.ip || '127.0.0.1')
    .then(() => next())
    .catch((err) => {
      if (err instanceof Error) {
        return res.status(500).json({ success: false, statusCode: 500, message: 'Internal Server Error' });
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
        return res.status(500).json({ success: false, statusCode: 500, message: 'Internal Server Error' });
      }
      res.status(429).json({ success: false, statusCode: 429, message: 'Too many OTP requests, try again after 15 minutes.' });
    });
};
