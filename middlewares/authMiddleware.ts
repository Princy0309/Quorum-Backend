import { Request, Response, NextFunction } from "express";
import {
  verifyAccessToken,
  AccessTokenPayload,
} from "../services/tokenService.js";
import { ApiError } from "../utils/ApiError.js";
import prisma from "../config/prisma.js";
import redis from "../config/redis.js";
import { User } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: Omit<User, "passwordHash">;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new ApiError(401, "Unauthorized, missing token"));
  }

  const token = authHeader.split(" ")[1];

  let decoded: AccessTokenPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    return next(new ApiError(401, "Invalid or expired token"));
  }

  if (!decoded.sid) {
    return next(new ApiError(401, "Invalid token: missing session ID"));
  }

  let isSessionActive = false;
  try {
    const isRedisActive = await redis.exists(`refresh:${decoded.sid}`);
    if (isRedisActive) {
      isSessionActive = true;
    } else {
      const dbSession = await prisma.refreshToken.findFirst({
        where: { familyId: decoded.sid, revokedAt: null },
      });
      if (dbSession) {
        const remainingSeconds = Math.floor((dbSession.expiresAt.getTime() - Date.now()) / 1000);
        if (remainingSeconds > 0) {
          isSessionActive = true;
          Promise.all([
            redis.set(
              `refresh:${dbSession.familyId}`,
              JSON.stringify({
                userId: dbSession.userId,
                device: dbSession.device,
              }),
              "EX",
              remainingSeconds,
            ),
            redis.sadd(`user_sessions:${dbSession.userId}`, dbSession.familyId),
            redis.expire(`user_sessions:${dbSession.userId}`, remainingSeconds),
          ]).catch(() => {});
        }
      }
    }
  } catch (err) {
    try {
      const dbSession = await prisma.refreshToken.findFirst({
        where: { familyId: decoded.sid, revokedAt: null },
      });
      if (dbSession) {
        isSessionActive = true;
      }
    } catch (dbErr) {
      return next(new ApiError(500, "Internal Server Error"));
    }
  }

  if (!isSessionActive) {
    return next(new ApiError(401, "Session revoked"));
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return next(new ApiError(401, "User no longer exists"));
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return next(new ApiError(403, "Account is temporarily locked due to ,ultiple failed login attemots. Please try again later"));
    }
    const { passwordHash, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (err) {
    return next(new ApiError(500, "Internal Server Error"));
  }
};

export const authorizeRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, "Forbidden, insufficient permissions"));
    }
    next();
  };
};

export const requireEmailVerified = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user || !req.user.isEmailVerified) {
    return next(
      new ApiError(
        403,
        "Please verify your email address before accessing this resource",
      ),
    );
  }
  next();
};
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];

  let decoded: AccessTokenPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    return next();
  }

  if (!decoded.sid) {
    return next();
  }

  let isSessionValid = false;
  try {
    const isRedisActive = await redis.exists(`refresh:${decoded.sid}`);
    if (isRedisActive) {
      isSessionValid = true;
    } else {
      const dbSession = await prisma.refreshToken.findFirst({
        where: { familyId: decoded.sid, revokedAt: null },
      });
      if (dbSession) {
        const remainingSeconds = Math.floor((dbSession.expiresAt.getTime() - Date.now()) / 1000);
        if (remainingSeconds > 0) {
          isSessionValid = true;
          Promise.all([
            redis.set(
              `refresh:${dbSession.familyId}`,
              JSON.stringify({
                userId: dbSession.userId,
                device: dbSession.device,
              }),
              "EX",
              remainingSeconds,
            ),
            redis.sadd(`user_sessions:${dbSession.userId}`, dbSession.familyId),
            redis.expire(`user_sessions:${dbSession.userId}`, remainingSeconds),
          ]).catch(() => {});
        }
      }
    }
  } catch (err) {
    try {
      const dbSession = await prisma.refreshToken.findFirst({
        where: { familyId: decoded.sid, revokedAt: null },
      });
      if (dbSession) {
        isSessionValid = true;
      }
    } catch (dbErr) {
      return next(new ApiError(500, "Internal Server Error"));
    }
  }

  if (isSessionValid) {
    try {
      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (user) {
        const { passwordHash, ...safeUser } = user;
        req.user = safeUser;
      }
    } catch (err) {
      return next(new ApiError(500, "Internal Server Error"));
    }
  }
  next();
};
