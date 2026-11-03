import { z } from 'zod';
import { UseCase } from '@prisma/client';

export const onboardingSchema = z.object({
    useCases: z.array(z.nativeEnum(UseCase)).default([]),
});

export const updateProfileSchema = z.object({
    name: z.string().trim().min(1, 'Name cannot be empty').max(100, 'Name cannot exceed 100 characters').optional(),
    avatar: z.string().trim().max(1000).optional().nullable(),
    useCases: z.preprocess((val) => {
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val);
                if (Array.isArray(parsed)) return parsed;
            } catch {
                return val.split(',').map((s) => s.trim()).filter(Boolean);
            }
        }
        return val;
    }, z.array(z.nativeEnum(UseCase)).optional()),
    isOnboarded: z.preprocess((val) => {
        if (typeof val === 'string') return val === 'true';
        return val;
    }, z.boolean().optional()),
});