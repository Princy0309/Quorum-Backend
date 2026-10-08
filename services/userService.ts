import prisma from "../config/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { UseCase } from '@prisma/client';

export const saveUserOnboarding = async (userId: string, useCases: UseCase[]) => {
    const existingUser = await prisma.user.findUnique({
        where: { id: userId},
        select: { id: true, isEmailVerified: true},
    });

    if(!existingUser){
        throw new ApiError(404, 'User not found');
    }

    const updateUser = await prisma.user.update({
        where: {id: userId},
        data: {
            isOnboarded: true,
            useCases: useCases,
        },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatar: true,
            isEmailVerified: true,
            isOnboarded: true,
            useCases: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    return updateUser;
};

export const searchUsers = async (
  currentUserId: string,
  query: string = '',
  page: number = 1,
  limit: number = 20
) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (pageNum - 1) * limitNum;
  const trimmed = query.trim();

  const whereCondition: any = {
    id: { not: currentUserId },
  };

  if (trimmed) {
    whereCondition.OR = [
      { name: { contains: trimmed, mode: 'insensitive' } },
      { email: { contains: trimmed, mode: 'insensitive' } },
    ];
  }

  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      where: whereCondition,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        createdAt: true,
      },
      skip,
      take: limitNum,
      orderBy: { name: 'asc' },
    }),
    prisma.user.count({
      where: whereCondition,
    }),
  ]);

  return {
    users,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
    },
  };
};