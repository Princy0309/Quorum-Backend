import { CookieOptions } from 'express';
import env from '../config/env.js';

const isProduction = env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  path: '/api/auth',
};

export default { refreshCookieOptions };
