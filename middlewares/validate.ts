import { Request, Response, NextFunction } from 'express';
import { Schema } from 'joi';
import { ApiError } from '../utils/ApiError.js';

export const validate = (schema: Schema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return next(new ApiError(400, error.details[0].message));
    }
    req.body = value;
    next();
  };
};
