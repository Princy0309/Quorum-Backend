import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';

export interface RecordAiInteractionInput {
  prompt: string;
  response: string;
  actionType?: string;
  conversationId?: string;
  model?: string;
  tokensUsed?: number;
}

export interface GetAiHistoryOptions {
  limit?: number;
  cursor?: string;
  actionType?: string;
  conversationId?: string;
}

const REDIS_KEY_PREFIX = 'ai_history:user:';

export const cleanExpiredAiHistory = async (retentionDays: number = 30) => {
  const safeDays = Math.max(retentionDays, 1);
  const cutoffDate = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

  const result = await prisma.aiInteraction.deleteMany({
    where: {
      createdAt: {
        lt: cutoffDate
      }
    }
  });

  return {
    deletedCount: result.count,
    cutoffDate: cutoffDate.toISOString()
  };
};

export const recordAiInteraction = async (
  userId: string,
  data: RecordAiInteractionInput
): Promise<void> => {
  try {
    const record = await prisma.aiInteraction.create({
      data: {
        userId,
        conversationId: data.conversationId || null,
        actionType: data.actionType || 'chat',
        prompt: data.prompt,
        response: data.response,
        model: data.model || null,
        tokensUsed: data.tokensUsed || null
      }
    });

    try {
      const cacheKey = `${REDIS_KEY_PREFIX}${userId}`;
      await redis.lpush(cacheKey, JSON.stringify(record));
      await redis.ltrim(cacheKey, 0, 49);
      await redis.expire(cacheKey, 86400);
    } catch {
    }

    if (Math.random() < 0.05) {
      cleanExpiredAiHistory(30).catch(() => {});
    }
  } catch (err: any) {
    logger.warn('Failed to persist AI interaction to database', {
      userId,
      error: err?.message
    });
  }
};

export const getUserAiHistory = async (
  userId: string,
  options?: GetAiHistoryOptions
) => {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const cursor = options?.cursor;
  const actionType = options?.actionType;
  const conversationId = options?.conversationId;

  const whereClause: any = {
    userId,
    ...(actionType ? { actionType } : {}),
    ...(conversationId ? { conversationId } : {})
  };

  const records = await prisma.aiInteraction.findMany({
    where: whereClause,
    take: limit + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }
    ]
  });

  let hasNextPage = false;
  let nextCursor: string | null = null;

  if (records.length > limit) {
    hasNextPage = true;
    records.pop();
  }

  if (records.length > 0 && hasNextPage) {
    nextCursor = records[records.length - 1].id;
  }

  return {
    history: records,
    pagination: {
      limit,
      hasNextPage,
      nextCursor
    }
  };
};

export const deleteUserAiHistory = async (
  userId: string,
  interactionId?: string
) => {
  let deletedCount = 0;

  if (interactionId) {
    const result = await prisma.aiInteraction.deleteMany({
      where: {
        id: interactionId,
        userId
      }
    });

    if (result.count === 0) {
      throw new ApiError(404, 'AI interaction not found');
    }
    deletedCount = result.count;
  } else {
    const result = await prisma.aiInteraction.deleteMany({
      where: {
        userId
      }
    });
    deletedCount = result.count;
  }

  try {
    const cacheKey = `${REDIS_KEY_PREFIX}${userId}`;
    await redis.del(cacheKey);
  } catch {
  }

  return {
    success: true,
    deletedCount,
    deletedId: interactionId || 'all'
  };
};
