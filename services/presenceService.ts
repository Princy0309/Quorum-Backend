import redis from '../config/redis.js';

const PRESENCE_TTL_SECONDS = 60;

export const setUserOnline = async (userId: string, socketId: string): Promise<boolean> => {
  const key = `user_sockets:${userId}`;
  const presenceKey = `presence:${userId}`;

  await redis.sadd(key, socketId);
  await redis.expire(key, PRESENCE_TTL_SECONDS);

  const count = await redis.scard(key);
  await redis.set(presenceKey, 'online', 'EX', PRESENCE_TTL_SECONDS);

  return count === 1;
};

export const refreshUserPresence = async (userId: string): Promise<void> => {
  const key = `user_sockets:${userId}`;
  const presenceKey = `presence:${userId}`;

  const currentPresence = await redis.get(presenceKey);
  if (currentPresence === 'online') {
    await redis.expire(key, PRESENCE_TTL_SECONDS);
    await redis.expire(presenceKey, PRESENCE_TTL_SECONDS);
  }
};

export const setUserOffline = async (userId: string, socketId: string): Promise<boolean> => {
  const key = `user_sockets:${userId}`;
  const presenceKey = `presence:${userId}`;

  await redis.srem(key, socketId);
  const count = await redis.scard(key);

  if (count === 0) {
    await redis.del(key);
    await redis.set(presenceKey, JSON.stringify({ status: 'offline', lastSeen: new Date() }), 'EX', 86400 * 30);
    return true;
  } else {
    await redis.expire(key, PRESENCE_TTL_SECONDS);
    await redis.expire(presenceKey, PRESENCE_TTL_SECONDS);
  }

  return false;
};

export const getUserPresence = async (userId: string) => {
  const data = await redis.get(`presence:${userId}`);
  if (!data) {
    return { isOnline: false };
  }

  if (data === 'online') {
    return { isOnline: true };
  }

  try {
    const parsed = JSON.parse(data);
    return { isOnline: false, lastSeen: parsed.lastSeen };
  } catch (err) {
    return { isOnline: false };
  }
};
