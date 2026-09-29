const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: (parseInt(process.env.REFRESH_TOKEN_TTL_SECONDS, 10) || 7 * 24 * 60 * 60) * 1000,
};

module.exports = { refreshCookieOptions };
