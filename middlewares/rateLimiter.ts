import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import redisClient from '../config/redis.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import env from '../config/env.js';

export const loginIpRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'login_ip_v2',
  points: 20,
  duration: 15 * 60,
  blockDuration: 15 * 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 20,
    duration: 15 * 60,
    blockDuration: 15 * 60
  })
});

export const loginAccountRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'login_account_v2',
  points: 10,
  duration: 15 * 60,
  blockDuration: 15 * 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 10,
    duration: 15 * 60,
    blockDuration: 15 * 60
  })
});

export const hashEmail = (email: string) => {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(email.trim().toLowerCase()).digest('hex');
};

export const refreshRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'refresh_v2',
  points: 20,
  duration: 15 * 60,
  blockDuration: 15 * 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 20,
    duration: 15 * 60,
    blockDuration: 15 * 60
  })
});

export const registerRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'register_v2',
  points: 5,
  duration: 60 * 60,
  blockDuration: 15 * 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 5,
    duration: 60 * 60,
    blockDuration: 15 * 60
  })
});

export const registerEmailRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'register_email_v1',
  points: 5,
  duration: 60 * 60,
  blockDuration: 15 * 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 5,
    duration: 60 * 60,
    blockDuration: 15 * 60
  })
});

export const searchRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'search_v1',
  points: 30,
  duration: 60,
  blockDuration: 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 30,
    duration: 60,
    blockDuration: 60
  })
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
    if (err && err.remainingPoints !== undefined) {
      return res.status(429).json({ success: false, statusCode: 429, message: 'Too many login attempts from this IP, try again after 15 minutes.' });
    }
    logger.warn('Login rate limiter encountered an error, failing open:', err);
    return next();
  }
};

export const refreshLimiter = (req: Request, res: Response, next: NextFunction): void => {
  refreshRateLimiter.consume(req.ip || '127.0.0.1')
    .then(() => next())
    .catch((err) => {
      if (err && err.remainingPoints !== undefined) {
        return res.status(429).json({ success: false, statusCode: 429, message: 'Too many refresh token requests, try again later.' });
      }
      logger.warn('Refresh rate limiter encountered an error, failing open:', err);
      return next();
    });
};

export const registerLimiter = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const ip = req.ip || '127.0.0.1';
    await registerRateLimiter.consume(ip);

    const email = req.body?.email;
    if (email) {
      const emailHash = hashEmail(email);
      await registerEmailRateLimiter.consume(emailHash);
    }

    next();
  } catch (err: any) {
    if (err && err.remainingPoints !== undefined) {
      return res.status(429).json({ success: false, statusCode: 429, message: 'Too many registration attempts, try again later.' });
    }
    logger.warn('Register rate limiter encountered an error, failing open:', err);
    return next();
  }
};

export const searchLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const key = (req.user as any)?.id || req.ip || '127.0.0.1';
  searchRateLimiter.consume(key)
    .then(() => next())
    .catch((err) => {
      if (err && err.remainingPoints !== undefined) {
        return res.status(429).json({ success: false, statusCode: 429, message: 'Too many search requests, please slow down.' });
      }
      logger.warn('Search rate limiter encountered an error, failing open:', err);
      return next();
    });
};

export const otpRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'otp_send_v3',
  points: 15,
  duration: 15 * 60,
  blockDuration: 2 * 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 15,
    duration: 15 * 60,
    blockDuration: 2 * 60
  })
});

export const otpVerifyRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'otp_verify_v3',
  points: 40,
  duration: 15 * 60,
  blockDuration: 2 * 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 40,
    duration: 15 * 60,
    blockDuration: 2 * 60
  })
});

export const otpLimiter = (req: Request, res: Response, next: NextFunction): void => {
  otpRateLimiter.consume(req.ip || '127.0.0.1')
    .then(() => next())
    .catch((err) => {
      if (err && err.remainingPoints !== undefined) {
        return res.status(429).json({ success: false, statusCode: 429, message: 'Too many OTP requests, try again shortly.' });
      }
      logger.warn('OTP rate limiter encountered an error, failing open:', err);
      return next();
    });
};

export const otpVerifyLimiter = (req: Request, res: Response, next: NextFunction): void => {
  otpVerifyRateLimiter.consume(req.ip || '127.0.0.1')
    .then(() => next())
    .catch((err) => {
      if (err && err.remainingPoints !== undefined) {
        return res.status(429).json({ success: false, statusCode: 429, message: 'Too many verification attempts, please try again shortly.' });
      }
      logger.warn('OTP verify rate limiter encountered an error, failing open:', err);
      return next();
    });
};

export const chatRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'chat_api_v1',
  points: 30,
  duration: 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 30,
    duration: 60
  })
});

export const chatLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.user?.id || req.ip || '127.0.0.1';
  chatRateLimiter.consume(key)
    .then(() => next())
    .catch((err) => {
      if (err && err.remainingPoints !== undefined) {
        return res.status(429).json({ success: false, statusCode: 429, message: 'Too many requests, please slow down.' });
      }
      logger.warn('Chat rate limiter encountered an error, failing open:', err);
      return next();
    });
};

export const socketMessageRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'socket_msg_v1',
  points: 10,
  duration: 5,
  blockDuration: 5
});

export const checkSocketMessageRateLimit = async (userId: string): Promise<boolean> => {
  try {
    await socketMessageRateLimiter.consume(userId);
    return true;
  } catch (err) {
    return false;
  }
};

export const socketTypingRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'socket_typing_v1',
  points: 15,
  duration: 5,
  blockDuration: 3
});

export const checkSocketTypingRateLimit = async (userId: string): Promise<boolean> => {
  try {
    await socketTypingRateLimiter.consume(userId);
    return true;
  } catch (err) {
    return false;
  }
};

export const meetingJoinRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'socket_meeting_join_v1',
  points: 6,
  duration: 10,
  blockDuration: 5
});

export const checkMeetingJoinRateLimit = async (userId: string): Promise<boolean> => {
  try {
    await meetingJoinRateLimiter.consume(userId);
    return true;
  } catch (err: any) {
    if (err instanceof Error) return true;
    return false;
  }
};

export const meetingToggleRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'socket_meeting_toggle_v1',
  points: 8,
  duration: 3,
  blockDuration: 2
});

export const checkMeetingToggleRateLimit = async (userId: string): Promise<boolean> => {
  try {
    await meetingToggleRateLimiter.consume(userId);
    return true;
  } catch (err: any) {
    if (err instanceof Error) return true;
    return false;
  }
};

export const sfuSignalingRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'socket_sfu_signal_v1',
  points: 15,
  duration: 10,
  blockDuration: 5
});

export const checkSfuSignalingRateLimit = async (userId: string): Promise<boolean> => {
  try {
    await sfuSignalingRateLimiter.consume(userId);
    return true;
  } catch (err: any) {
    if (err instanceof Error) return true;
    return false;
  }
};

export const sfuIceRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'socket_sfu_ice_v1',
  points: 80,
  duration: 5,
  blockDuration: 3
});

export const checkSfuIceRateLimit = async (userId: string): Promise<boolean> => {
  try {
    await sfuIceRateLimiter.consume(userId);
    return true;
  } catch (err: any) {
    if (err instanceof Error) return true;
    return false;
  }
};

const aiMemoryFallbackLimiter = new RateLimiterMemory({
  points: 20,
  duration: 60,
  blockDuration: 60
});

export const aiRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'ai_api_v1',
  points: 20,
  duration: 60,
  blockDuration: 60,
  insuranceLimiter: aiMemoryFallbackLimiter
});

export const aiUserRateLimiter = aiRateLimiter;

export const aiRateLimiterMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.user?.id || req.ip || '127.0.0.1';
  aiRateLimiter.consume(key)
    .then((rateLimiterRes) => {
      res.setHeader('X-RateLimit-Limit', '20');
      res.setHeader('X-RateLimit-Remaining', String(rateLimiterRes.remainingPoints));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + Math.ceil(rateLimiterRes.msBeforeNext / 1000)));
      next();
    })
    .catch((err) => {
      if (err instanceof Error) {
        return next();
      }
      res.setHeader('X-RateLimit-Limit', '20');
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + Math.ceil(err.msBeforeNext / 1000)));
      res.status(429).json({ success: false, statusCode: 429, message: 'Too many AI requests. Please slow down and try again shortly.' });
    });
};

export const uploadBurstRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'upload_burst_v1',
  points: 10,
  duration: 60,
  blockDuration: 5 * 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 10,
    duration: 60,
    blockDuration: 5 * 60
  })
});

export const uploadDailyQuotaLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'upload_daily_v1',
  points: 100,
  duration: 24 * 60 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: new RateLimiterMemory({
    points: 100,
    duration: 24 * 60 * 60,
    blockDuration: 60 * 60
  })
});

export const uploadLimiterMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const key = (req.user?.id || req.ip || '127.0.0.1').toString();

  try {
    const burstRes = await uploadBurstRateLimiter.consume(key);
    const dailyRes = await uploadDailyQuotaLimiter.consume(key);

    res.setHeader('X-RateLimit-Limit', '10');
    res.setHeader('X-RateLimit-Remaining', String(burstRes.remainingPoints));
    res.setHeader('X-RateLimit-Daily-Remaining', String(dailyRes.remainingPoints));
    return next();
  } catch (err: any) {
    if (err && typeof err.msBeforeNext === 'number') {
      const waitSeconds = Math.ceil(err.msBeforeNext / 1000);
      const isDaily = err.msBeforeNext > 60 * 1000;
      const message = isDaily
        ? `Daily upload quota reached (maximum 100 files per 24 hours). Please try again in ${Math.ceil(waitSeconds / 60)} minutes.`
        : `Upload rate limit exceeded. You can only upload up to 10 files per minute. Please wait ${waitSeconds} seconds.`;

      res.setHeader('Retry-After', String(waitSeconds));
      return res.status(429).json({
        success: false,
        statusCode: 429,
        message,
        retryAfterSeconds: waitSeconds
      });
    }

    logger.warn('Upload rate limiter error, failing open:', err);
    return next();
  }
};



