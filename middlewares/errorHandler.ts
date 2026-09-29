import { Request, Response, NextFunction } from 'express';

const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err.message, err.stack);

  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational === true;

  res.status(statusCode).json({
    success: false,
    message: isOperational || statusCode < 500
      ? err.message
      : 'Internal Server Error',
  });
};

export default errorHandler;
