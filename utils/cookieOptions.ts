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

export const getAccessCookieOptions = (rememberMe: boolean = true): CookieOptions => {
  const options: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
  if (rememberMe) {
    options.maxAge = 15 * 60 * 1000;
  }
  return options;
};

export const getRefreshCookieOptions = (rememberMe: boolean = true): CookieOptions => {
  const options: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
  if (rememberMe) {
    options.maxAge = env.REFRESH_TOKEN_TTL_SECONDS * 1000;
  }
  return options;
};

export const accessCookieOptions: CookieOptions = getAccessCookieOptions(true);
export const refreshCookieOptions: CookieOptions = getRefreshCookieOptions(true);

export const clearCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/',
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export const csrfCookieOptions: CookieOptions = {
  httpOnly: false,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/',
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export default {
  accessCookieOptions,
  refreshCookieOptions,
  getAccessCookieOptions,
  getRefreshCookieOptions,
  clearCookieOptions,
  csrfCookieOptions
};
