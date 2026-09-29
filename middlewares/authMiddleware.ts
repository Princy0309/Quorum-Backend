import { Request, Response, NextFunction } from 'express';
const { verifyAccessToken } = require('../services/tokenService');
const { sendError } = require('../utils/apiResponse');
const prisma = require('../config/prisma');

export const authMiddleware = async (req: Request | any, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'Unauthorized, missing token');
  }

  const token = authHeader.split(' ')[1];

  let decoded: any;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    return sendError(res, 401, 'Invalid or expired token');
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return sendError(res, 401, 'User no longer exists');
    }
    const { passwordHash, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (err) {
    return sendError(res, 500, 'Internal Server Error');
  }
};

export const authorizeRoles = (...roles: string[]) => {
  return (req: Request | any, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return sendError(res, 403, 'Forbidden, insufficient permissions');
    }
    next();
  };
};
