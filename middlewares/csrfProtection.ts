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

export const verifyCSRF = (req: Request, res: Response, next: NextFunction) => {
  // If the request does not include any cookies, it is not subject to cookie-based CSRF.
  // Native clients using Authorization headers or custom transport bypass this check.
  const hasCookies = req.cookies && Object.keys(req.cookies).length > 0;
  
  if (!hasCookies) {
    return next();
  }

  // For browser requests on state-changing routes, validate origin/referer
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
    
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
  }

  next();
};

export default verifyCSRF;
