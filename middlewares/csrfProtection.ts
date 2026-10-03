import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError.js';
import crypto from 'crypto';
import env from '../config/env.js';

const allowedOrigins = env.ALLOWED_ORIGINS 
  ? env.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim()).filter(Boolean)
  : [
      'https://quorum-web-omega.vercel.app',
      'https://newquorum.me',
      'https://www.newquorum.me',
      'http://localhost:3000',
      'http://localhost:5173',
    ];

export const verifyCSRF = (req: Request, res: Response, next: NextFunction) => {
  const isMobile = req.headers['x-client-platform'] === 'mobile';
  if (isMobile) {
    return next();
  }

  let csrfToken = req.cookies['XSRF-TOKEN'];
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('XSRF-TOKEN', csrfToken, {
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      httpOnly: false,
    });
  }
  res.locals.csrfToken = csrfToken;

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    let origin = req.headers.origin;
    if (!origin && req.headers.referer) {
      try {
        origin = new URL(req.headers.referer).origin;
      } catch (err) {
        return next();
      }
    }
    
    if (!origin) {
      return next(new ApiError(403, 'CSRF validation failed: Missing origin'));
    }

    const isAllowedDomain = allowedOrigins.includes(origin);
    const isLocalDev = env.NODE_ENV !== 'production' && (
      origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
    );

    if (!isAllowedDomain && !isLocalDev) {
      return next(new ApiError(403, 'CSRF validation failed: Unauthorized origin'));
    }
    const hasAuthCookie = !!req.cookies['refreshToken'];
    
    if (hasAuthCookie) {
      const headerToken = req.headers['x-xsrf-token'] || req.headers['x-csrf-token'];
      if (!headerToken || headerToken !== csrfToken) {
        return next(new ApiError(403, 'CSRF validation failed: Token mismatch'));
      }
    }
  }

  next();
};

export default verifyCSRF;
