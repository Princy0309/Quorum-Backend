import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/tokenService';
import { ApiError } from '../utils/ApiError';
import prisma from '../config/prisma';

export const authMiddleware = async (req: Request | any, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new ApiError(401, 'Unauthorized, missing token'));
  }

  const token = authHeader.split(' ')[1];

  let decoded: any;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    return next(new ApiError(401, 'Invalid or expired token'));
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return next(new ApiError(401, 'User no longer exists'));
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