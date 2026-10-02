import { CookieOptions } from 'express';

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: (parseInt(process.env.REFRESH_TOKEN_TTL_SECONDS || '', 10) || 7 * 24 * 60 * 60) * 1000,
};

export default { refreshCookieOptions };
