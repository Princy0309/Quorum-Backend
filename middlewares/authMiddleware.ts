import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, AccessTokenPayload } from '../services/tokenService';
import { ApiError } from '../utils/ApiError';
import prisma from '../config/prisma';
import redis from '../config/redis';

export const authMiddleware = async (req: Request | any, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new ApiError(401, 'Unauthorized, missing token'));
  }

  const token = authHeader.split(' ')[1];

  let decoded: AccessTokenPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    return next(new ApiError(401, 'Invalid or expired token'));
  }

  if (decoded.sid) {
    try {
      const isActive = await redis.exists(`refresh:${decoded.sid}`);
      if (!isActive) {
        return next(new ApiError(401, 'Session revoked'));
      }
    } catch (err) {
      // If Redis fails, we might choose to allow or deny. We'll deny for strict security.
      return next(new ApiError(500, 'Internal Server Error'));
    }
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return next(new ApiError(401, 'User no longer exists'));
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return next(new ApiError(403, 'User account is temporarily locked or suspended'));
    }
    const { passwordHash, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (err) {
    return next(new ApiError(500, 'Internal Server Error'));
  }
};

export const authorizeRoles = (...roles: string[]) => {
  return (req: Request | any, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Forbidden, insufficient permissions'));
    }
    next();
  };
};

export const requireEmailVerified = (req: Request | any, res: Response, next: NextFunction) => {

  if(!req.user || !req.user.isEmailVerified){
    return next(new ApiError(403, 'Please verify your email address before accessing this resource'));
  }
  next();
}
export const optionalAuth = async (req: Request | any, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded: AccessTokenPayload = verifyAccessToken(token);
    
    let isSessionValid = true;
    if (decoded.sid) {
      try {
        const isActive = await redis.exists(`refresh:${decoded.sid}`);
        if (!isActive) isSessionValid = false;
      } catch (err) {
        isSessionValid = false;
      }
    }

    if (isSessionValid) {
      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (user && (!user.lockedUntil || user.lockedUntil <= new Date())) {
        const { passwordHash, ...safeUser } = user;
        req.user = safeUser;
      }
    }
  } catch (err) {
    
  }
  next();
};
