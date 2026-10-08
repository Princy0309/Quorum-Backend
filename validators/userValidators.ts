import { z } from 'zod';
import { UseCase } from '@prisma/client';

export const onboardingSchema = z.object({
    useCases: z.array(z.nativeEnum(UseCase)).default([]),
});