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

  // If the request does not include any cookies, it is not subject to cookie-based CSRF.
  // Native clients using Authorization headers or custom transport bypass this check.
  const hasCookies = req.cookies && Object.keys(req.cookies).length > 0;
  
  if (!hasCookies) {
    return next();
  }

  // For browser requests on state-changing routes, validate origin/referer
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

    // Double-submit cookie verification (Synchronizer token pattern)
    // If the frontend does not send the header, and relies on Origin only, 
    // we log a warning or enforce it based on strictness. Here we enforce it if the cookie was sent.
    const headerToken = req.headers['x-xsrf-token'] || req.headers['x-csrf-token'];
    if (csrfToken && headerToken !== csrfToken) {
      return next(new ApiError(403, 'CSRF validation failed: Token mismatch'));
    }
  }

  next();
};

export default verifyCSRF;
