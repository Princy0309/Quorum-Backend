import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import { issueTokens } from './tokenService';
import { storeAndSendOTP } from './otpService';
import { loginRateLimiter } from '../middlewares/rateLimiter';
import { Request } from 'express';
import { User } from '@prisma/client';

export const handleFailedLogin = async (userId: string, currentAttempts: number) => {
  const newAttempts = currentAttempts + 1;
  let lockedUntil = null;
  if (newAttempts >= 5) {
    lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lock
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: newAttempts,
      lockedUntil,
    },
  });
};

export const registerUser = async (name: string, email: string, passwordHash: string) => {
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    if (existingUser.isEmailVerified) {
      return { isNew: false, isVerified: true };
    }

    const user = await prisma.user.update({
      where: { id: existingUser.id },
      data: { name, passwordHash },
    });

    try {
      await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');
    } catch (err) {
      console.error('Failed to send OTP during registration (existing unverified):', err);
    }

    return { isNew: false, isVerified: false };
  }

  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  });

  try {
    await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');
  } catch (err) {
    console.error('Failed to send OTP during registration:', err);
  }

  return { isNew: true, isVerified: false };
};

export const loginUser = async (email: string, password: string, ip: string, req: Request) => {
  const user = await prisma.user.findUnique({ where: { email } });
  
  if (!user) {
    await loginRateLimiter.consume(ip).catch(() => {});
    throw new ApiError(401, 'Invalid credentials');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(403, 'Account is temporarily locked due to multiple failed login attempts. Please try again later.');
  }

  if (!user.passwordHash) {
    await loginRateLimiter.consume(ip).catch(() => {});
    await handleFailedLogin(user.id, user.failedLoginAttempts);
    throw new ApiError(401, 'Invalid credentials');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    await loginRateLimiter.consume(ip).catch(() => {});
    await handleFailedLogin(user.id, user.failedLoginAttempts);
    throw new ApiError(401, 'Invalid credentials');
  }

  if (!user.isEmailVerified) {
    await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');
    throw new ApiError(403, 'Email not verified. A fresh verification code has been sent to your email.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { 
      lastLogin: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null
    },
  });

  const tokens = await issueTokens(user, req);

  return { user, ...tokens };
};
