import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

const errorHandler = (err: Error | ApiError, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  const isOperational = err instanceof ApiError ? err.isOperational : false;

  // Structured logging
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
    console.error('SERVER ERROR:', JSON.stringify(errorLog));
  } else {
    console.warn('CLIENT ERROR:', JSON.stringify(errorLog));
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message: isOperational || statusCode < 500
      ? err.message
      : 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

export default errorHandler;
