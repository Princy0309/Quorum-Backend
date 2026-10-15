import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny } from 'zod';
import { ApiError } from '../utils/ApiError.js';

export const validate = (schema: ZodTypeAny | any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (schema && typeof schema.safeParse === 'function') {
      const result = schema.safeParse(req.body);
      if (!result.success) {
        return next(new ApiError(400, result.error.issues[0]?.message || 'Validation error'));
      }
      req.body = result.data;
      return next();
    }
    if (schema && typeof schema.validate === 'function') {
      const { error, value } = schema.validate(req.body);
      if (error) {
        return next(new ApiError(400, error.details?.[0]?.message || 'Validation error'));
      }
      req.body = value;
      return next();
    }
    next();
  };
};

export const validateJoi = validate;

