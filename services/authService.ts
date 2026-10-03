import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { issueTokens } from './tokenService.js';
import { storeAndSendOTP } from './otpService.js';
import { loginAccountRateLimiter, hashEmail } from '../middlewares/rateLimiter.js';
import { Request } from 'express';
import { User } from '@prisma/client';

export const handleFailedLogin = async (userId: string) => {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return;

    let attempts = user.failedLoginAttempts;
    if (user.lockedUntil && user.lockedUntil <= new Date()) {
      attempts = 0;
    }

    attempts += 1;

    const updateData: any = { failedLoginAttempts: attempts };
    if (user.lockedUntil && user.lockedUntil <= new Date()) {
      updateData.lockedUntil = null;
    }

    if (attempts >= 5) {
      updateData.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    }

    await tx.user.update({
      where: { id: userId },
      data: updateData,
    });
  });
};

export const registerUser = async (name: string, email: string, passwordUnHashed: string) => {
  const passwordHash = await bcrypt.hash(passwordUnHashed, 10);

  const existingUser = await prisma.user.findUnique({ where: { email } });
  
  if (existingUser) {
    if (existingUser.isEmailVerified) {
      throw new ApiError(409, 'Email already registered. Please log in.');
    }
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: { name, passwordHash },
    });
    try {
      await storeAndSendOTP(updatedUser.email, `otp:verify:${updatedUser.id}`, 'verification');
    } catch (err) {
      console.error('Failed to send OTP during registration (existing unverified):', err);
    }

    return { user: updatedUser, isNew: false, isVerified: false };
  }

  let user;
  try {
    user = await prisma.user.create({
      data: { name, email, passwordHash },
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      throw new ApiError(409, 'Email already registered. Please log in.');
    }
    throw err;
  }

  try {
    await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');
  } catch (err) {
    console.error('Failed to send OTP during registration:', err);
  }

  return { user, isNew: true, isVerified: false };
};

export const loginUser = async (email: string, password: string, ip: string, req: Request) => {
  const user = await prisma.user.findUnique({ where: { email } });
  
  let isMatch = false;
  if (user && user.passwordHash) {
    isMatch = await bcrypt.compare(password, user.passwordHash);
  } else {
    await bcrypt.compare(password, '$2a$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
  }
  if (user && user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(403, 'Account is temporarily locked due to multiple failed login attempts. Please try again later.');
  }

  if (!user || !isMatch) {
    await loginAccountRateLimiter.consume(hashEmail(email)).catch(() => {});
    if (user) {
      await handleFailedLogin(user.id);
    }
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
