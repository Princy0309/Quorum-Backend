import { CookieOptions } from 'express';
import env from '../config/env.js';

const isProduction = env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';

const cookieDomain = process.env.COOKIE_DOMAIN || (env.NODE_ENV === 'production' && env.CLIENT_URL?.includes('newquorum.me') ? '.newquorum.me' : undefined);

export const accessCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: 15 * 60 * 1000,
  path: '/',
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  path: '/',
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export default { accessCookieOptions, refreshCookieOptions };
