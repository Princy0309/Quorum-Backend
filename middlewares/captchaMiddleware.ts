import { Request, Response, NextFunction } from 'express';
import { verifyCaptchaToken } from '../services/captchaService.js';
import { ApiError } from '../utils/ApiError.js';

export async function requireCaptcha(req: Request, _res: Response, next: NextFunction) {
  const token =
    req.body?.captchaToken ||
    req.headers['x-captcha-token'] ||
    req.headers['cf-turnstile-response'];

  const forwarded = req.headers['x-forwarded-for'];
  const remoteIp =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined) ||
    (typeof req.headers['cf-connecting-ip'] === 'string' ? req.headers['cf-connecting-ip'] : undefined) ||
    req.ip;

  const result = await verifyCaptchaToken(typeof token === 'string' ? token : undefined, remoteIp);

  if (!result.success) {
    return next(new ApiError(403, 'CAPTCHA verification failed. Please try again.'));
  }

  next();
}
