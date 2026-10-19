import redis from '../config/redis.js';
import logger from '../utils/logger.js';

export const DEFAULT_SFU_WORKERS: string[] = [
  'sfu-worker-1',
  'sfu-worker-2',
  'sfu-worker-3',
  'sfu-worker-4',
];

export const hashRoomCode = (roomCode: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < roomCode.length; i++) {
    hash ^= roomCode.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export class RoomSharder {
  private workers: string[];

  constructor(workers: string[] = DEFAULT_SFU_WORKERS) {
    this.workers = workers;
  }

  public getDeterministicWorker(roomCode: string): string {
    const hash = hashRoomCode(roomCode);
    const index = hash % this.workers.length;
    return this.workers[index];
  }

  public async getOrAssignWorker(roomCode: string): Promise<string> {
    const redisKey = `sfu:room:${roomCode}:worker`;

    try {
      const existingWorker = await redis.get(redisKey);
      if (existingWorker) {
        return existingWorker;
      }

      const assignedWorker = this.getDeterministicWorker(roomCode);

      await redis.set(redisKey, assignedWorker, 'EX', 86400);
      await redis.sadd(`sfu:worker:${assignedWorker}:rooms`, roomCode);

      logger.info(`[RoomSharder] Assigned room ${roomCode} to ${assignedWorker}`);
      return assignedWorker;
    } catch (error) {
      logger.error(`[RoomSharder] Redis lookup failed for room ${roomCode}, falling back to local hash:`, error);
      return this.getDeterministicWorker(roomCode);
    }
  }

  public async releaseRoom(roomCode: string): Promise<void> {
    const redisKey = `sfu:room:${roomCode}:worker`;

    try {
      const assignedWorker = await redis.get(redisKey);
      if (assignedWorker) {
        await redis.del(redisKey);
        await redis.srem(`sfu:worker:${assignedWorker}:rooms`, roomCode);
        logger.info(`[RoomSharder] Released room ${roomCode} from ${assignedWorker}`);
      }
    } catch (error) {
      logger.error(`[RoomSharder] Error releasing room ${roomCode}:`, error);
    }
  }

  public async getWorkerRooms(workerId: string): Promise<string[]> {
    try {
      return await redis.smembers(`sfu:worker:${workerId}:rooms`);
    } catch (error) {
      logger.error(`[RoomSharder] Error getting rooms for worker ${workerId}:`, error);
      return [];
    }
  }
}

export const roomSharder = new RoomSharder();
