import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import { issueTokens } from './tokenService';
import { storeAndSendOTP } from './otpService';
import { loginAccountRateLimiter, hashEmail } from '../middlewares/rateLimiter';
import { Request } from 'express';
import { User } from '@prisma/client';

export const handleFailedLogin = async (userId: string) => {
  await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    if (updatedUser.failedLoginAttempts >= 5) {
      await tx.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
      });
    }
  });
};

export const registerUser = async (name: string, email: string, passwordUnHashed: string) => {
  const existingUser = await prisma.user.findUnique({ where: { email } });
  
  if (existingUser) {
    if (existingUser.isEmailVerified) {
      return { isNew: false, isVerified: true };
    }

    const passwordHash = await bcrypt.hash(passwordUnHashed, 10);

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

  const passwordHash = await bcrypt.hash(passwordUnHashed, 10);

  let user;
  try {
    user = await prisma.user.create({
      data: { name, email, passwordHash },
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return { isNew: false, isVerified: false };
    }
    throw err;
  }

  try {
    await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');
  } catch (err) {
    console.error('Failed to send OTP during registration:', err);
  }

  return { isNew: true, isVerified: false };
};

export const loginUser = async (email: string, password: string, ip: string, req: Request) => {
  const user = await prisma.user.findUnique({ where: { email } });
  
  let isMatch = false;
  if (user && user.passwordHash) {
    isMatch = await bcrypt.compare(password, user.passwordHash);
  } else {
    await bcrypt.compare(password, '$2a$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
  }

  if (!user || !isMatch) {
    await loginAccountRateLimiter.consume(hashEmail(email)).catch(() => {});
    if (user) {
      await handleFailedLogin(user.id);
    }
    throw new ApiError(401, 'Invalid credentials');
  }

  // 2. Check account restrictions and email verification
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(403, 'Account is temporarily locked due to multiple failed login attempts. Please try again later.');
  }

  if (!user.isEmailVerified) {
    await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');
    throw new ApiError(403, 'Email not verified. A fresh verification code has been sent to your email.');
  }

  // Reset lock and update last login
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
