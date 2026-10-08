import redis from '../config/redis.js';

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

export const getMultipleUserPresences = async (userIds: string[]) => {
  if (!userIds || userIds.length === 0) {
    return new Map<string, { isOnline: boolean; lastSeen?: Date }>();
  }

  const keys = userIds.map((id) => `presence:${id}`);
  const results = await redis.mget(...keys);

  const presenceMap = new Map<string, { isOnline: boolean; lastSeen?: Date }>();

  results.forEach((val, idx) => {
    const userId = userIds[idx];
    if (!val) {
      presenceMap.set(userId, { isOnline: false });
    } else if (val === 'online') {
      presenceMap.set(userId, { isOnline: true });
    } else {
      try {
        const parsed = JSON.parse(val);
        presenceMap.set(userId, { isOnline: false, lastSeen: parsed.lastSeen });
      } catch (err) {
        presenceMap.set(userId, { isOnline: false });
      }
    }
  });

  return presenceMap;
};
