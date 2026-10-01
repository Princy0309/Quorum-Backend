import { Request, Response, NextFunction } from 'express';
import { generateSecret, generateURI, verifySync } from 'otplib';
import qrcode from 'qrcode';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/apiResponse';
import { issueTokens } from '../services/tokenService';
import { refreshCookieOptions } from '../utils/cookieOptions';

export const generate2FASecret = asyncHandler(async (req: Request | any, res: Response, next: NextFunction) => {
  const userId = req.user.id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, 'User not found');

  const secret = generateSecret();
  const otpauth = generateURI({ secret, label: user.email, issuer: 'Quorum' });
  const qrCodeUrl = await qrcode.toDataURL(otpauth);

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret },
  });

  return sendSuccess(res, 200, '2FA QR Code generated successfully', { secret, qrCodeUrl });
});

export const enable2FA = asyncHandler(async (req: Request | any, res: Response, next: NextFunction) => {
  const userId = req.user.id;
  const { code } = req.body;
  if (!code) throw new ApiError(400, '2FA verification code is required');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorSecret) throw new ApiError(400, '2FA setup not initiated');

  const verification = verifySync({ token: String(code).trim(), secret: user.twoFactorSecret });
  if (!verification.valid) throw new ApiError(400, 'Invalid 2FA code');

  await prisma.user.update({
    where: { id: userId },
    data: { is2FAEnabled: true },
  });

  return sendSuccess(res, 200, '2FA enabled successfully');
});

export const verify2FALogin = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { mfaToken, code } = req.body;
  if (!mfaToken || !code) throw new ApiError(400, 'mfaToken and 2FA code are required');

  let payload: any;
  try {
    payload = jwt.verify(mfaToken, process.env.JWT_SECRET || 'secret');
  } catch (err) {
    throw new ApiError(401, 'MFA session expired or invalid');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.twoFactorSecret) throw new ApiError(400, 'User 2FA not configured');

  const verification = verifySync({ token: String(code).trim(), secret: user.twoFactorSecret });
  if (!verification.valid) throw new ApiError(401, 'Invalid 2FA code');

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  const { accessToken, refreshToken } = await issueTokens(user, req);
  const isMobile = req.headers['x-client-platform'] === 'mobile';

  if (isMobile) {
    return sendSuccess(res, 200, '2FA authentication successful', { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
  } else {
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    return sendSuccess(res, 200, '2FA authentication successful', { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
  }
});

