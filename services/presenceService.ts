import redis from '../config/redis.js';
import prisma from '../config/prisma.js';
import logger from '../utils/logger.js';

export type PresenceStatus =
  | 'AVAILABLE'
  | 'BUSY'
  | 'DO_NOT_DISTURB'
  | 'BE_RIGHT_BACK'
  | 'AWAY'
  | 'OFFLINE';

export interface UserPresenceData {
  isOnline: boolean;
  status: PresenceStatus;
  statusMessage?: string | null;
  statusExpiresAt?: Date | null;
  lastSeen?: Date | null;
}

export interface CustomStatusInput {
  status: PresenceStatus;
  statusMessage?: string | null;
  clearAfterMinutes?: number | null;
}


const PRESENCE_TTL_SECONDS = 60;
const STALE_SOCKET_THRESHOLD_MS = 60 * 1000;

const pruneStaleSockets = async (userId: string): Promise<number> => {
  const hashKey = `presence_sockets:${userId}`;
  const allSockets = await redis.hgetall(hashKey);
  const now = Date.now();
  const staleSocketIds: string[] = [];
  let activeCount = 0;

  for (const [socketId, timestampStr] of Object.entries(allSockets)) {
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp) || now - timestamp > STALE_SOCKET_THRESHOLD_MS) {
      staleSocketIds.push(socketId);
    } else {
      activeCount++;
    }
  }

  if (staleSocketIds.length > 0) {
    await redis.hdel(hashKey, ...staleSocketIds);
  }

  return activeCount;
};

export const setUserOnline = async (userId: string, socketId: string): Promise<boolean> => {
  const hashKey = `presence_sockets:${userId}`;
  const presenceKey = `presence:${userId}`;

  const activeCountBefore = await pruneStaleSockets(userId);

  await redis.hset(hashKey, socketId, Date.now().toString());
  await redis.expire(hashKey, PRESENCE_TTL_SECONDS * 2);
  await redis.set(presenceKey, 'online', 'EX', PRESENCE_TTL_SECONDS);

  return activeCountBefore === 0;
};

export const refreshUserPresence = async (userId: string, socketId: string): Promise<void> => {
  const hashKey = `presence_sockets:${userId}`;
  const presenceKey = `presence:${userId}`;

  await redis.hset(hashKey, socketId, Date.now().toString());
  await redis.expire(hashKey, PRESENCE_TTL_SECONDS * 2);

  const activeCount = await pruneStaleSockets(userId);

  if (activeCount > 0) {
    await redis.set(presenceKey, 'online', 'EX', PRESENCE_TTL_SECONDS);
  } else {
    await redis.set(presenceKey, JSON.stringify({ status: 'offline', lastSeen: new Date() }), 'EX', 86400 * 30);
  }
};

export const setUserOffline = async (userId: string, socketId: string): Promise<boolean> => {
  const hashKey = `presence_sockets:${userId}`;
  const presenceKey = `presence:${userId}`;

  await redis.hdel(hashKey, socketId);
  const activeCount = await pruneStaleSockets(userId);

  if (activeCount === 0) {
    await redis.del(hashKey);
    await redis.set(presenceKey, JSON.stringify({ status: 'offline', lastSeen: new Date() }), 'EX', 86400 * 30);
    return true;
  } else {
    await redis.expire(hashKey, PRESENCE_TTL_SECONDS * 2);
    await redis.set(presenceKey, 'online', 'EX', PRESENCE_TTL_SECONDS);
    return false;
  }
};

export const getUserPresence = async (userId: string): Promise<UserPresenceData> => {
  const presenceKey = `presence:${userId}`;
  const customStatusKey = `user:custom_status:${userId}`;

  const [presenceRaw, customRaw] = await redis.mget(presenceKey, customStatusKey);

  let isOnline = false;
  let lastSeen: Date | null = null;

  if (presenceRaw === 'online') {
    isOnline = true;
  } else if (presenceRaw) {
    try {
      const parsed = JSON.parse(presenceRaw);
      isOnline = false;
      lastSeen = parsed.lastSeen ? new Date(parsed.lastSeen) : null;
    } catch {
      isOnline = false;
    }
  }

  let status: PresenceStatus = isOnline ? 'AVAILABLE' : 'OFFLINE';
  let statusMessage: string | null = null;
  let statusExpiresAt: Date | null = null;

  if (customRaw) {
    try {
      const parsedCustom = JSON.parse(customRaw);
      if (parsedCustom.status) {
        status = isOnline ? parsedCustom.status : 'OFFLINE';
        statusMessage = parsedCustom.statusMessage || null;
        statusExpiresAt = parsedCustom.statusExpiresAt ? new Date(parsedCustom.statusExpiresAt) : null;
      }
    } catch (err: any){
      logger.warn(`[PresenceService] Invalid custom status JSON for user ${userId}: ${err.message}`);
    }
  }

  if (!isOnline && !lastSeen) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { lastLogin: true },
      });
      lastSeen = user?.lastLogin || null;
    } catch {
      lastSeen = null;
    }
  }

  return {
    isOnline,
    status,
    statusMessage,
    statusExpiresAt,
    lastSeen,
  };
};

export const getMultipleUserPresences = async (
  userIds: string[]
): Promise<Map<string, UserPresenceData>> => {
  if (!userIds || userIds.length === 0) {
    return new Map<string, UserPresenceData>();
  }

  const presenceKeys = userIds.map((id) => `presence:${id}`);
  const customStatusKeys = userIds.map((id) => `user:custom_status:${id}`);

  // Fetch all presence and custom statuses for all users in parallel
  const [presenceResults, customResults] = await Promise.all([
    redis.mget(...presenceKeys),
    redis.mget(...customStatusKeys),
  ]);

  const presenceMap = new Map<string, UserPresenceData>();
  const missingUserIds: string[] = [];

  userIds.forEach((userId, idx) => {
    const pVal = presenceResults[idx];
    const cVal = customResults[idx];

    let isOnline = false;
    let lastSeen: Date | null = null;

    if (pVal === 'online') {
      isOnline = true;
    } else if (pVal) {
      try {
        const parsed = JSON.parse(pVal);
        isOnline = false;
        lastSeen = parsed.lastSeen ? new Date(parsed.lastSeen) : null;
      } catch {
        isOnline = false;
      }
    } else {
      missingUserIds.push(userId);
    }

    let status: PresenceStatus = isOnline ? 'AVAILABLE' : 'OFFLINE';
    let statusMessage: string | null = null;
    let statusExpiresAt: Date | null = null;

    if (cVal) {
      try {
        const parsedCustom = JSON.parse(cVal);
        if (parsedCustom.status) {
          status = isOnline ? parsedCustom.status : 'OFFLINE';
          statusMessage = parsedCustom.statusMessage || null;
          statusExpiresAt = parsedCustom.statusExpiresAt ? new Date(parsedCustom.statusExpiresAt) : null;
        }
      } catch (err: any) {
        logger.warn(`[PresenceService] Invalid custom status for user ${userId}: ${err.message}`);
      }
    }

    presenceMap.set(userId, {
      isOnline,
      status,
      statusMessage,
      statusExpiresAt,
      lastSeen,
    });
  });

  // Database fallback for lastSeen if missing from Redis
  if (missingUserIds.length > 0) {
    try {
      const users = await prisma.user.findMany({
        where: { id: { in: missingUserIds } },
        select: { id: true, lastLogin: true },
      });
      for (const u of users) {
        if (u.lastLogin) {
          const current = presenceMap.get(u.id);
          if (current) {
            current.lastSeen = u.lastLogin;
          }
        }
      }
    } catch (err: any) {
       logger.warn(`[PresenceService] Failed to fetch lastLogin fallback for missing users: ${err.message}`);
    }
  }

  return presenceMap;
};

export const setUserCustomStatus = async (
  userId: string,
  input: CustomStatusInput
): Promise<UserPresenceData> => {
  const customStatusKey = `user:custom_status:${userId}`;
  const now = new Date();
  const expiresAt = input.clearAfterMinutes
    ? new Date(now.getTime() + input.clearAfterMinutes * 60 * 1000)
    : null;

  const payload = {
    status: input.status,
    statusMessage: input.statusMessage ? input.statusMessage.trim().slice(0, 100) : null,
    statusExpiresAt: expiresAt ? expiresAt.toISOString() : null,
  };

  if (input.clearAfterMinutes && input.clearAfterMinutes > 0) {
    await redis.set(
      customStatusKey,
      JSON.stringify(payload),
      'EX',
      input.clearAfterMinutes * 60
    );
  } else {
    await redis.set(customStatusKey, JSON.stringify(payload));
  }

  return getUserPresence(userId);
};

export const clearUserCustomStatus = async (userId: string): Promise<UserPresenceData> => {
  const customStatusKey = `user:custom_status:${userId}`;
  await redis.del(customStatusKey);
  return getUserPresence(userId);
};
