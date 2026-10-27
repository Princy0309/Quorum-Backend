import { CookieOptions } from 'express';
import env from '../config/env.js';

const isProduction = env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';

const getCookieDomain = (): string | undefined => {
  if (process.env.COOKIE_DOMAIN) {
    return process.env.COOKIE_DOMAIN;
  }
  if (!isProduction || !env.CLIENT_URL) {
    return undefined;
  }
  try {
    const parsed = new URL(env.CLIENT_URL);
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return undefined;
    }
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return '.' + parts.slice(-2).join('.');
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const cookieDomain = getCookieDomain();

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
