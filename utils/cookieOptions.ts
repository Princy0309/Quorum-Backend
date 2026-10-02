import { CookieOptions } from 'express';

const isProduction = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: (parseInt(process.env.REFRESH_TOKEN_TTL_SECONDS || '', 10) || 7 * 24 * 60 * 60) * 1000,
  path: '/',
};

export default { refreshCookieOptions };
