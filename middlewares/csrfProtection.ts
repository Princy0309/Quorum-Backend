import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError.js';
import crypto from 'crypto';
import env, { isOriginAllowed } from '../config/env.js';

export const verifyCSRF = (req: Request, res: Response, next: NextFunction) => {
  const isMobile = req.headers['x-client-platform'] === 'mobile';
  if (isMobile) {
    return next();
  }

  const originHeader = req.headers.origin;
  const host = req.get('host');
  if (originHeader && host && originHeader.includes(host)) {
    return next();
  }

  const isAuthEndpoint = 
    req.path.includes('/login') ||
    req.path.includes('/register') ||
    req.path.includes('/refresh') ||
    req.path.includes('/forgot-password') ||
    req.path.includes('/reset-password') ||
    req.path.includes('/otp');

  if (isAuthEndpoint) {
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
      } catch {
        return next();
      }
    }
    
    if (!origin) {
      return next();
    }

    if (!isOriginAllowed(origin)) {
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
