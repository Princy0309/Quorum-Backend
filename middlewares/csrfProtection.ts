import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [
      'https://quorum-web-omega.vercel.app',
      'https://newquorum.me',
      'https://www.newquorum.me',
      'http://localhost:3000',
      'http://localhost:5173',
    ];

import crypto from 'crypto';

export const verifyCSRF = (req: Request, res: Response, next: NextFunction) => {
  let csrfToken = req.cookies['XSRF-TOKEN'];
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('XSRF-TOKEN', csrfToken, {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      httpOnly: false,
    });
  }
  res.locals.csrfToken = csrfToken;


  const hasCookies = req.cookies && Object.keys(req.cookies).length > 0;
  
  if (!hasCookies) {
    return next();
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    let origin = req.headers.origin;
    if (!origin && req.headers.referer) {
      try {
        origin = new URL(req.headers.referer).origin;
      } catch (err) {
        return next(new ApiError(403, 'CSRF validation failed: Malformed referer'));
      }
    }
    
    if (!origin) {
      return next(new ApiError(403, 'CSRF validation failed: Missing origin'));
    }

    const isAllowedDomain = allowedOrigins.includes(origin);
    const isLocalDev = process.env.NODE_ENV !== 'production' && (
      origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
    );

    if (!isAllowedDomain && !isLocalDev) {
      return next(new ApiError(403, 'CSRF validation failed: Unauthorized origin'));
    }



    const headerToken = req.headers['x-xsrf-token'] || req.headers['x-csrf-token'];
    if (csrfToken && headerToken !== csrfToken) {
      return next(new ApiError(403, 'CSRF validation failed: Token mismatch'));
    }
  }

  next();
};

export default verifyCSRF;
