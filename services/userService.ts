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
}