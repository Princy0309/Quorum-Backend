import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';

const errorHandler = (err: Error | ApiError, req: Request, res: Response, next: NextFunction) => {
  let statusCode = err instanceof ApiError ? err.statusCode : 500;
  const isOperational = err instanceof ApiError ? err.isOperational : false;

  let message = isOperational || statusCode < 500
    ? err.message
    : 'Internal Server Error';

  const anyErr = err as any;
  if (anyErr?.code === 'P2002') {
    statusCode = 409;
    message = 'A record with this information already exists.';
  } else if (anyErr?.code === 'P2025') {
    statusCode = 404;
    message = 'Requested record not found.';
  } else if (anyErr?.code === 'P2003') {
    statusCode = 400;
    message = 'Invalid reference to a related resource.';
  } else if (err.name?.startsWith('PrismaClient') || (typeof err.message === 'string' && (err.message.includes('Prisma') || err.message.includes('prisma')))) {
    statusCode = 500;
    message = 'A database error occurred. Please try again later.';
  }

  const errorLog = {
    message: err.message,
    statusCode,
    isOperational,
    path: req.path,
    method: req.method,
    ip: req.ip,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  };

  if (statusCode >= 500) {
    logger.error('SERVER ERROR:', errorLog);
  } else {
    logger.warn('CLIENT ERROR:', errorLog);
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

export default errorHandler;
