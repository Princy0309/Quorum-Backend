import redis from '../config/redis.js';

export const setUserOnline = async (userId: string, socketId: string): Promise<boolean> => {
  const key = `user_sockets:${userId}`;
  await redis.sadd(key, socketId);
  const count = await redis.scard(key);
  await redis.set(`presence:${userId}`, 'online');
  return count === 1;
};

export const setUserOffline = async (userId: string, socketId: string): Promise<boolean> => {
  const key = `user_sockets:${userId}`;
  await redis.srem(key, socketId);
  const count = await redis.scard(key);

  if (count === 0) {
    await redis.del(key);
    await redis.set(`presence:${userId}`, JSON.stringify({ status: 'offline', lastSeen: new Date() }));
    return true;
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
