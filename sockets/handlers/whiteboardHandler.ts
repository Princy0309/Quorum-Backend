import { Server, Socket } from 'socket.io';
import prisma from '../../config/prisma.js';
import redis from '../../config/redis.js';
import logger from '../../utils/logger.js';
import {
  assertUserBelongsToOrganization,
  assertUserCanAccessMeeting,
  findMeetingByCodeOrId,
} from '../../services/whiteboardService.js';
import { Prisma } from '@prisma/client';
import { getIO } from '../socketServer.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  UpdateWhiteboardInput,
  socketDrawElementSchema,
  socketElementsChangeSchema,
  socketViewStatePayloadSchema,
  socketCursorMoveSchema,
} from '../../validators/whiteboardValidators.js';

interface WhiteboardSession {
  boardId: string;
  organizationId: string;
  elements: Map<string, any>;
  viewState: any;
  activeUsers: Map<string, { userId: string; name: string }>;
  version: number;          
  lastSavedVersion: number; 
  isSaving: boolean;        
  saveTimer: NodeJS.Timeout | null;
  hasUnsyncedLocalChanges: boolean;
  needsReconciliation: boolean;
}

const activeSessions = new Map<string, WhiteboardSession>();

const sessionInitPromises = new Map<string, Promise<WhiteboardSession>>();

const socketBoardsMap = new Map<string, Set<string>>();

const SAVE_DEBOUNCE_MS = 2500;
const REDIS_BOARD_TTL = 86400; 
const LOCK_TTL_MS = 15000;      
const LOCK_HEARTBEAT_MS = 5000; 

const REDIS_PREFIX = 'whiteboard:';
export const getBoardElementsKey = (boardId: string) => `${REDIS_PREFIX}${boardId}:elements`;
export const getBoardViewStateKey = (boardId: string) => `${REDIS_PREFIX}${boardId}:viewState`;
export const getBoardUsersKey = (boardId: string) => `${REDIS_PREFIX}${boardId}:users`;
export const getBoardVersionKey = (boardId: string) => `${REDIS_PREFIX}${boardId}:version`;
export const getBoardLastSavedKey = (boardId: string) => `${REDIS_PREFIX}${boardId}:lastSaved`;
export const getBoardLockKey = (boardId: string) => `${REDIS_PREFIX}${boardId}:lock`;
export const getBoardClearedKey = (boardId: string) => `${REDIS_PREFIX}${boardId}:cleared`;

class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = this.queue;
    this.queue = this.queue.then(() => next);
    await current;
    return release;
  }
}

const localBoardLocks = new Map<string, AsyncMutex>();

const getBoardLocalLock = (boardId: string): AsyncMutex => {
  let mutex = localBoardLocks.get(boardId);
  if (!mutex) {
    mutex = new AsyncMutex();
    localBoardLocks.set(boardId, mutex);
  }
  return mutex;
};

const RENEW_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

const RESYNC_LOCAL_STATE_SCRIPT = `
  redis.call('DEL', KEYS[1])
  local count = #ARGV
  if count > 2 then
    for i = 3, count, 2 do
      redis.call('HSET', KEYS[1], ARGV[i], ARGV[i+1])
    end
    redis.call('EXPIRE', KEYS[1], ARGV[2])
    redis.call('DEL', KEYS[4])
  else
    redis.call('SET', KEYS[4], '1', 'EX', ARGV[2])
  end
  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
  local newVer = redis.call('INCR', KEYS[3])
  redis.call('EXPIRE', KEYS[3], ARGV[2])
  return newVer
`;

const executeWithBoardLock = async <T>(
  boardId: string,
  action: (checkLock: () => Promise<void>) => Promise<T>
): Promise<T> => {
  const localMutex = getBoardLocalLock(boardId);
  const releaseLocalLock = await localMutex.acquire();
  let redisLockAcquired = false;
  let lockLost = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  const lockKey = getBoardLockKey(boardId);
  const lockVal = `socket-${process.pid}-${Date.now()}-${Math.random()}`;
  const SOCKET_LOCK_TTL_MS = 6000;
  const SOCKET_LOCK_HEARTBEAT_MS = 2000;

  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const res = await redis.set(lockKey, lockVal, 'PX', SOCKET_LOCK_TTL_MS, 'NX');
        if (res === 'OK') {
          redisLockAcquired = true;
          break;
        }
      } catch {
        if (process.env.SINGLE_INSTANCE === 'true') {
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (!redisLockAcquired && process.env.SINGLE_INSTANCE !== 'true') {
      throw new Error('Whiteboard is currently busy with another update. Please retry.');
    }

    if (redisLockAcquired) {
      heartbeatTimer = setInterval(async () => {
        try {
          const renewed = await redis.eval(
            RENEW_LOCK_SCRIPT,
            1,
            lockKey,
            lockVal,
            SOCKET_LOCK_TTL_MS
          );
          if (renewed !== 1) {
            lockLost = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        } catch {
          lockLost = true;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }, SOCKET_LOCK_HEARTBEAT_MS);
    }

    const checkLock = async (): Promise<void> => {
      if (lockLost) {
        throw new Error('Distributed lock ownership lost during socket update. Please retry.');
      }
      if (redisLockAcquired) {
        let current: string | null = null;
        try {
          current = await redis.get(lockKey);
        } catch {
          lockLost = true;
          throw new Error('Redis connection lost during lock check. Please retry.');
        }
        if (current !== lockVal) {
          lockLost = true;
          throw new Error('Distributed lock was overtaken by another operation. Please retry.');
        }
      }
    };

    const session = activeSessions.get(boardId);
    if (session && session.needsReconciliation) {
      try {
        const dbBoard = await prisma.whiteboard.findUnique({
          where: { id: boardId },
          select: { content: true },
        });
        if (dbBoard && dbBoard.content && typeof dbBoard.content === 'object') {
          const content = dbBoard.content as any;
          if (Array.isArray(content.elements)) {
            session.elements.clear();
            for (const el of content.elements) {
              if (el && el.id) {
                session.elements.set(el.id, el);
              }
            }
          }
          if (content.viewState) {
            session.viewState = content.viewState;
          }
          if (typeof content._version === 'number') {
            session.version = content._version;
            session.lastSavedVersion = content._version;
          }
          try {
            const scriptArgs: (string | number)[] = [
              JSON.stringify(session.viewState || {}),
              REDIS_BOARD_TTL,
            ];
            for (const [elId, el] of session.elements.entries()) {
              scriptArgs.push(elId, JSON.stringify(el));
            }
            await redis.eval(
              RESYNC_LOCAL_STATE_SCRIPT,
              4,
              getBoardElementsKey(boardId),
              getBoardViewStateKey(boardId),
              getBoardVersionKey(boardId),
              getBoardClearedKey(boardId),
              ...scriptArgs
            );
          } catch {}
          session.needsReconciliation = false;
        }
      } catch {}
    } else if (session && !session.hasUnsyncedLocalChanges) {
      try {
        const clusterVerStr = await redis.get(getBoardVersionKey(boardId));
        const clusterVer = clusterVerStr ? parseInt(clusterVerStr, 10) || 0 : 0;
        if (clusterVer > session.version) {
          const [rawElements, rawViewState] = await Promise.all([
            redis.hgetall(getBoardElementsKey(boardId)),
            redis.get(getBoardViewStateKey(boardId)),
          ]);
          if (rawElements) {
            session.elements.clear();
            for (const [id, jsonStr] of Object.entries(rawElements)) {
              try {
                const el = JSON.parse(jsonStr);
                if (el && typeof el === 'object') {
                  session.elements.set(el.id || id, el);
                }
              } catch {}
            }
          }
          if (rawViewState) {
            try {
              session.viewState = JSON.parse(rawViewState);
            } catch {}
          }
          session.version = clusterVer;
        }
      } catch {}
    }

    const result = await action(checkLock);

    await checkLock();

    return result;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (redisLockAcquired && !lockLost) {
      const unlockScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await redis.eval(unlockScript, 1, lockKey, lockVal);
      } catch {}
    }
    releaseLocalLock();
  }
};

export const cleanupWhiteboardSession = async (boardId: string): Promise<void> => {
  const localMutex = getBoardLocalLock(boardId);
  const releaseLocalLock = await localMutex.acquire();
  let redisLockAcquired = false;
  const lockKey = getBoardLockKey(boardId);
  const lockVal = `del-${process.pid}-${Date.now()}-${Math.random()}`;

  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await redis.set(lockKey, lockVal, 'PX', LOCK_TTL_MS, 'NX');
        if (res === 'OK') {
          redisLockAcquired = true;
          break;
        }
      } catch {
        if (process.env.SINGLE_INSTANCE === 'true') {
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const session = activeSessions.get(boardId);
    if (session) {
      if (session.saveTimer) {
        clearTimeout(session.saveTimer);
        session.saveTimer = null;
      }
      activeSessions.delete(boardId);
    }

    for (const [socketId, boards] of socketBoardsMap.entries()) {
      boards.delete(boardId);
      if (boards.size === 0) {
        socketBoardsMap.delete(socketId);
      }
    }

    try {
      const io = getIO();
      const roomName = `whiteboard:${boardId}`;
      io.to(roomName).emit('whiteboard:deleted', { boardId });
      io.in(roomName).socketsLeave(roomName);
    } catch {}

    try {
      await redis.del(
        getBoardElementsKey(boardId),
        getBoardViewStateKey(boardId),
        getBoardUsersKey(boardId),
        getBoardVersionKey(boardId),
        getBoardLastSavedKey(boardId),
        getBoardLockKey(boardId),
        getBoardClearedKey(boardId)
      );
    } catch {}
  } finally {
    if (redisLockAcquired) {
      const unlockScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await redis.eval(unlockScript, 1, lockKey, lockVal);
      } catch {}
    }
    releaseLocalLock();
  }
};

const isPipelineSuccessful = (results: [Error | null, unknown][] | null): boolean => {
  if (!results || results.length === 0) {
    return false;
  }
  return results.every(([err]) => !err);
};

const joinRateLimitMap = new Map<string, { count: number; resetTime: number }>();

const checkJoinRateLimit = (key: string): boolean => {
  const now = Date.now();
  if (joinRateLimitMap.size > 1000) {
    for (const [k, v] of joinRateLimitMap.entries()) {
      if (now > v.resetTime) {
        joinRateLimitMap.delete(k);
      }
    }
  }
  const record = joinRateLimitMap.get(key);
  if (!record || now > record.resetTime) {
    joinRateLimitMap.set(key, { count: 1, resetTime: now + 10000 });
    return true;
  }
  if (record.count >= 15) {
    return false;
  }
  record.count++;
  return true;
};

export const flushBoardToDatabase = async (boardId: string): Promise<boolean> => {

  const localMutex = getBoardLocalLock(boardId);
  const releaseLocalLock = await localMutex.acquire();

  let redisLockAcquired = false;
  let lockLost = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  const lockKey = getBoardLockKey(boardId);
  const lockVal = `${process.pid}-${Date.now()}-${Math.random()}`;

  const session = activeSessions.get(boardId);

  try {

    try {
      const res = await redis.set(lockKey, lockVal, 'PX', LOCK_TTL_MS, 'NX');
      redisLockAcquired = res === 'OK';
    } catch (err: any) {
      logger.warn(
        `[Whiteboard Socket] Redis distributed lock unavailable, operating with process-local mutex fallback: ${err.message}`
      );
      redisLockAcquired = false;
    }

    if (!redisLockAcquired) {

      let redisHealthy = true;
      try {
        const ping = await redis.ping();
        redisHealthy = ping === 'PONG';
      } catch {
        redisHealthy = false;
      }

      if (redisHealthy) {

        logger.info(
          `[Whiteboard Socket] Save for board ${boardId} is already in progress on another cluster instance. Skipping overlapping flush.`
        );
        return true;
      }

      logger.warn(
        `[Whiteboard Socket] Redis is offline. Persisting board ${boardId} under process-local mutex fallback.`
      );
    } else {

      heartbeatTimer = setInterval(async () => {
        try {
          const renewed = await redis.eval(RENEW_LOCK_SCRIPT, 1, lockKey, lockVal, LOCK_TTL_MS);
          if (renewed !== 1) {
            lockLost = true;
            logger.warn(
              `[Whiteboard Socket] Distributed lock renewal failed for board ${boardId}. Lock was lost or expired.`
            );
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        } catch (err: any) {
          logger.warn(
            `[Whiteboard Socket] Error renewing distributed lock for board ${boardId}: ${err.message}`
          );
        }
      }, LOCK_HEARTBEAT_MS);
    }

    if (session?.saveTimer) {
      clearTimeout(session.saveTimer);
      session.saveTimer = null;
    }
    if (session) {
      session.isSaving = true;
    }

    let elementsArray: any[] = [];
    let viewState: any = {};
    let versionToSave = 0;
    let authoritativeSource: 'local' | 'redis' | null = null;
    let redisSnapshotSucceeded = false;
    let redisVersion = 0;
    let lastSavedVersion = 0;
    let versionAtSnapshot = 0;

    let isRedisExplicitlyCleared = false;

    const SNAPSHOT_SCRIPT = `
      local elements = redis.call('HGETALL', KEYS[1])
      local viewState = redis.call('GET', KEYS[2])
      local version = redis.call('GET', KEYS[3])
      local lastSaved = redis.call('GET', KEYS[4])
      local cleared = redis.call('GET', KEYS[5])
      return { elements, viewState, version or '0', lastSaved or '0', cleared or '0' }
    `;

    const redisElementsMap = new Map<string, any>();
    let redisViewState: any = null;

    try {
      const [rawElementsArr, rawViewState, redisVerStr, lastSavedStr, redisClearedStr] = (await redis.eval(
        SNAPSHOT_SCRIPT,
        5,
        getBoardElementsKey(boardId),
        getBoardViewStateKey(boardId),
        getBoardVersionKey(boardId),
        getBoardLastSavedKey(boardId),
        getBoardClearedKey(boardId)
      )) as [string[], string | null, string, string, string];

      redisVersion = parseInt(redisVerStr || '0', 10);
      lastSavedVersion = parseInt(lastSavedStr || '0', 10);
      versionAtSnapshot = redisVersion;
      isRedisExplicitlyCleared = redisClearedStr === '1';
      redisSnapshotSucceeded = true;

      if (Array.isArray(rawElementsArr) && rawElementsArr.length > 0) {
        for (let i = 0; i < rawElementsArr.length; i += 2) {
          const jsonStr = rawElementsArr[i + 1];
          if (jsonStr) {
            try {
              const el = JSON.parse(jsonStr);
              if (el && el.id) {
                redisElementsMap.set(el.id, el);
              }
            } catch {}
          }
        }
      }

      if (rawViewState) {
        try {
          redisViewState = JSON.parse(rawViewState);
        } catch {}
      }
    } catch (err: any) {
      logger.warn(
        `[Whiteboard Socket] Failed to read atomic snapshot from Redis during flush: ${err.message}`
      );
      redisSnapshotSucceeded = false;
    }

    const isLocalSessionNewer =
      session &&
      (session.hasUnsyncedLocalChanges ||
        session.version > redisVersion ||
        !redisSnapshotSucceeded);

    if (
      !isLocalSessionNewer &&
      redisSnapshotSucceeded &&
      redisVersion > 0 &&
      redisVersion <= lastSavedVersion &&
      (!session || session.version <= session.lastSavedVersion)
    ) {
      if (session) {
        session.isSaving = false;
      }
      return true;
    }

    let redisResyncSucceeded = false;
    if (isLocalSessionNewer && session) {

      authoritativeSource = 'local';
      elementsArray = Array.from(session.elements.values());
      viewState = session.viewState || {};

      if (redisSnapshotSucceeded) {
        try {
          const scriptArgs: (string | number)[] = [
            JSON.stringify(viewState),
            REDIS_BOARD_TTL,
          ];
          for (const [elId, el] of session.elements.entries()) {
            scriptArgs.push(elId, JSON.stringify(el));
          }

          const newSharedVersion = (await redis.eval(
            RESYNC_LOCAL_STATE_SCRIPT,
            4,
            getBoardElementsKey(boardId),
            getBoardViewStateKey(boardId),
            getBoardVersionKey(boardId),
            getBoardClearedKey(boardId),
            ...scriptArgs
          )) as number | string | null;

          if (newSharedVersion !== null && newSharedVersion !== undefined) {
            redisResyncSucceeded = true;
            if (typeof newSharedVersion === 'number') {
              versionToSave = newSharedVersion;
            } else if (typeof newSharedVersion === 'string') {
              versionToSave = parseInt(newSharedVersion, 10) || Math.max(redisVersion + 1, session.version);
            }
          } else {
            versionToSave = Math.max(redisVersion + 1, session.version);
          }
          session.version = Math.max(session.version, versionToSave);
        } catch (syncErr: any) {
          logger.warn(`[Whiteboard Socket] Failed to re-sync local state to Redis: ${syncErr.message}`);
          versionToSave = Math.max(redisVersion + 1, session.version);
        }
      } else {
        versionToSave = session.version;
      }
    } else if (
      redisSnapshotSucceeded &&
      (redisElementsMap.size > 0 || redisVersion > 0 || isRedisExplicitlyCleared)
    ) {

      authoritativeSource = 'redis';
      elementsArray = Array.from(redisElementsMap.values());
      viewState = redisViewState || session?.viewState || {};
      versionToSave = redisVersion;
    } else if (session) {

      authoritativeSource = 'local';
      elementsArray = Array.from(session.elements.values());
      viewState = session.viewState || {};
      versionToSave = session.version;
    }

    if (!authoritativeSource) {
      logger.warn(
        `[Whiteboard Socket] Aborting save for board ${boardId}: No trustworthy snapshot or session available. Refusing to write empty state.`
      );
      if (session) {
        session.isSaving = false;
      }
      return false;
    }

    if (redisLockAcquired && lockLost) {
      logger.warn(
        `[Whiteboard Socket] Distributed lock expired/lost for board ${boardId} before DB write. Aborting stale write.`
      );
      if (session) {
        session.isSaving = false;
        scheduleDebouncedSave(session, 1000);
      }
      return false;
    }

    const payloadWithVersion: Prisma.InputJsonObject = {
      elements: elementsArray,
      viewState,
      _version: versionToSave,
    };

    let writeCommitted = false;
    await prisma.$transaction(async (tx) => {

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`whiteboard:${boardId}`}))`;

      const currentBoard = await tx.whiteboard.findUnique({
        where: { id: boardId },
        select: { content: true },
      });

      if (currentBoard && currentBoard.content && typeof currentBoard.content === 'object') {
        const currentContent = currentBoard.content as any;
        const currentDbVersion = typeof currentContent._version === 'number' ? currentContent._version : 0;

        if (currentDbVersion > versionToSave) {
          logger.warn(
            `[Whiteboard Socket] Database-level optimistic concurrency check aborted write for board ${boardId}: DB contains v${currentDbVersion} > current v${versionToSave}. Skipping stale overwrite.`
          );
          return;
        }
      }

      await tx.whiteboard.update({
        where: { id: boardId },
        data: {
          content: payloadWithVersion,
        },
      });
      writeCommitted = true;
    });

    if (!writeCommitted) {
      if (session) {
        session.isSaving = false;
      }
      return true;
    }

    let postSaveRedisPipelineSucceeded = false;
    try {
      const p = redis.pipeline();
      p.set(getBoardLastSavedKey(boardId), versionToSave.toString());
      if (elementsArray.length > 0) {
        p.del(getBoardClearedKey(boardId));
      } else {
        p.set(getBoardClearedKey(boardId), '1', 'EX', REDIS_BOARD_TTL);
      }
      const results = await p.exec();
      if (isPipelineSuccessful(results)) {
        postSaveRedisPipelineSucceeded = true;
      }
    } catch {}

    if (session) {
      session.lastSavedVersion = versionToSave;
      session.isSaving = false;
      const isSynchronized =
        (authoritativeSource === 'redis' && postSaveRedisPipelineSucceeded) ||
        (authoritativeSource === 'local' && redisResyncSucceeded && postSaveRedisPipelineSucceeded);

      if (isSynchronized) {
        session.hasUnsyncedLocalChanges = false;
        session.needsReconciliation = false;
      } else {
        session.hasUnsyncedLocalChanges = true;
        session.needsReconciliation = true;
        scheduleDebouncedSave(session, 1500);
      }
    }

    logger.info(
      `[Whiteboard Socket] Safely persisted board ${boardId} to database from ${authoritativeSource} source (v${versionToSave}, ${elementsArray.length} elements).`
    );

    let versionAfterSave = versionToSave;
    try {
      const currentVerStr = await redis.get(getBoardVersionKey(boardId));
      if (currentVerStr) {
        versionAfterSave = parseInt(currentVerStr, 10);
      }
    } catch {}

    const hasNewerRedisVersion = versionAfterSave > versionToSave;
    const hasNewerLocalVersion = session ? session.version > versionToSave : false;

    if (hasNewerRedisVersion || hasNewerLocalVersion) {
      logger.info(
        `[Whiteboard Socket] Mutations occurred during database save for board ${boardId} (Redis: ${versionToSave} -> ${versionAfterSave}, local: ${versionToSave} -> ${session?.version}). Scheduling follow-up save.`
      );
      if (session) {
        scheduleDebouncedSave(session, 1000);
      } else {
        setTimeout(() => {
          flushBoardToDatabase(boardId).catch((err) => {
            logger.error(`[Whiteboard Socket] Error in follow-up save: ${err.message}`);
          });
        }, 1000);
      }
    } else {

      let totalClusterUsers = 0;
      try {
        totalClusterUsers = await redis.hlen(getBoardUsersKey(boardId));
      } catch {
        totalClusterUsers = session?.activeUsers.size || 0;
      }

      if (totalClusterUsers === 0) {
        activeSessions.delete(boardId);
        logger.info(
          `[Whiteboard Socket] Released empty, fully persisted session across cluster for board ${boardId}.`
        );
      }
    }

    return true;
  } catch (err: any) {
    if (session) {
      session.isSaving = false;
      scheduleDebouncedSave(session, 5000);
    }
    logger.error(
      `[Whiteboard Socket] Failed to persist board ${boardId} to database: ${err.message}`
    );
    return false;
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (redisLockAcquired && !lockLost) {

      const unlockScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await redis.eval(unlockScript, 1, lockKey, lockVal);
      } catch {}
    }
    releaseLocalLock();
  }
};

const scheduleDebouncedSave = (session: WhiteboardSession, delay = SAVE_DEBOUNCE_MS) => {
  if (session.saveTimer) {
    clearTimeout(session.saveTimer);
  }
  session.saveTimer = setTimeout(() => {
    flushBoardToDatabase(session.boardId).catch((err) => {
      logger.error(`[Whiteboard Socket] Error in scheduled save: ${err.message}`);
    });
  }, delay);
};

const getOrCreateSession = async (boardId: string): Promise<WhiteboardSession> => {
  const existing = activeSessions.get(boardId);
  if (existing) {
    return existing;
  }

  const inFlight = sessionInitPromises.get(boardId);
  if (inFlight) {
    return inFlight;
  }

  const initPromise = (async () => {
    try {
      let elementsMap = new Map<string, any>();
      let viewState = { zoom: 1, scrollX: 0, scrollY: 0, backgroundColor: '#ffffff' };
      let organizationId = '';

      let hasValidRedisElements = false;
      let isRedisElementsCorrupt = false;
      let hasRedisViewState = false;
      let hasRedisVersionKey = false;
      let initialClusterVersion = 0;
      let isRedisExplicitlyCleared = false;

      try {
        const [rawElements, rawViewState, rawVersion, rawCleared] = await Promise.all([
          redis.hgetall(getBoardElementsKey(boardId)),
          redis.get(getBoardViewStateKey(boardId)),
          redis.get(getBoardVersionKey(boardId)),
          redis.get(getBoardClearedKey(boardId)),
        ]);

        if (rawCleared === '1') {
          isRedisExplicitlyCleared = true;
        }

        if (rawVersion !== null && rawVersion !== undefined) {
          hasRedisVersionKey = true;
          initialClusterVersion = parseInt(rawVersion, 10) || 0;
        }

        const totalRawKeys = rawElements ? Object.keys(rawElements).length : 0;
        if (totalRawKeys > 0) {
          let parsedValidCount = 0;
          for (const [id, jsonStr] of Object.entries(rawElements)) {
            try {
              const el = JSON.parse(jsonStr);
              if (el && typeof el === 'object' && (el.id || id)) {
                elementsMap.set(el.id || id, el);
                parsedValidCount++;
              }
            } catch {}
          }

          if (parsedValidCount > 0 && parsedValidCount === totalRawKeys) {
            hasValidRedisElements = true;
          } else {
            logger.warn(
              `[Whiteboard Socket] Detected corrupt or invalid Redis elements for board ${boardId} (${parsedValidCount}/${totalRawKeys} valid). Recovering from PostgreSQL.`
            );
            isRedisElementsCorrupt = true;
            elementsMap.clear();
          }
        }

        if (rawViewState) {
          try {
            const parsed = JSON.parse(rawViewState);
            if (parsed && typeof parsed === 'object') {
              viewState = { ...viewState, ...parsed };
              hasRedisViewState = true;
            }
          } catch {}
        }
      } catch (err: any) {
        logger.warn(`[Whiteboard Socket] Redis load check error: ${err.message}`);
      }

      const board = await prisma.whiteboard.findUnique({
        where: { id: boardId },
        select: {
          id: true,
          organizationId: true,
          content: true,
        },
      });

      if (!board) {
        throw new Error('Whiteboard not found');
      }

      organizationId = board.organizationId;

      let pgElements: any[] = [];
      let pgViewState: any = null;
      let pgVersion = 0;

      if (board.content && typeof board.content === 'object') {
        const contentObj = board.content as any;
        if (Array.isArray(contentObj.elements)) {
          pgElements = contentObj.elements;
        } else if (Array.isArray(board.content)) {
          pgElements = board.content as any[];
        }
        if (contentObj.viewState && typeof contentObj.viewState === 'object') {
          pgViewState = contentObj.viewState;
        }
        if (typeof contentObj._version === 'number') {
          pgVersion = contentObj._version;
        }
      }

      const isValidEmptyBoard =
        !isRedisElementsCorrupt &&
        !hasValidRedisElements &&
        (isRedisExplicitlyCleared || (hasRedisVersionKey && initialClusterVersion > pgVersion));

      let shouldSeedElements = false;
      if (!hasValidRedisElements && !isValidEmptyBoard && pgElements.length > 0) {
        for (const el of pgElements) {
          if (el && el.id) {
            elementsMap.set(el.id, el);
          }
        }
        shouldSeedElements = true;
      }

      let shouldSeedViewState = false;
      if (!hasRedisViewState && pgViewState) {
        viewState = { ...viewState, ...pgViewState };
        shouldSeedViewState = true;
      }

      initialClusterVersion = Math.max(initialClusterVersion, pgVersion);

      if (shouldSeedElements || shouldSeedViewState) {
        try {
          const pipeline = redis.pipeline();
          if (shouldSeedElements) {

            pipeline.del(getBoardElementsKey(boardId));
            if (elementsMap.size > 0) {
              for (const [elId, el] of elementsMap.entries()) {
                pipeline.hset(getBoardElementsKey(boardId), elId, JSON.stringify(el));
              }
              pipeline.expire(getBoardElementsKey(boardId), REDIS_BOARD_TTL);
            }
          }
          if (shouldSeedViewState) {
            pipeline.set(getBoardViewStateKey(boardId), JSON.stringify(viewState));
            pipeline.expire(getBoardViewStateKey(boardId), REDIS_BOARD_TTL);
          }

          pipeline.setnx(getBoardVersionKey(boardId), initialClusterVersion.toString());
          pipeline.setnx(getBoardLastSavedKey(boardId), pgVersion.toString());
          pipeline.expire(getBoardVersionKey(boardId), REDIS_BOARD_TTL);
          pipeline.expire(getBoardLastSavedKey(boardId), REDIS_BOARD_TTL);
          await pipeline.exec();
        } catch (err: any) {
          logger.warn(`[Whiteboard Socket] Failed to seed/repair board state in Redis: ${err.message}`);
        }
      }

      const alreadyCreated = activeSessions.get(boardId);
      if (alreadyCreated) {
        return alreadyCreated;
      }

      const session: WhiteboardSession = {
        boardId: board.id,
        organizationId,
        elements: elementsMap,
        viewState,
        activeUsers: new Map(),
        version: initialClusterVersion,
        lastSavedVersion: pgVersion,
        isSaving: false,
        saveTimer: null,
        hasUnsyncedLocalChanges: false,
        needsReconciliation: false,
      };

      activeSessions.set(boardId, session);

      if (initialClusterVersion > pgVersion) {
        scheduleDebouncedSave(session);
      }

      return session;
    } finally {
      sessionInitPromises.delete(boardId);
    }
  })();

  sessionInitPromises.set(boardId, initPromise);
  return initPromise;
};

export const registerWhiteboardHandler = (io: Server, socket: Socket) => {
  const lastCursorBroadcastMap = new Map<string, number>();
  const CURSOR_THROTTLE_MS = 40;

  const getUserId = (): string | null => {
    return socket.data.user?.id || null;
  };

  const getUserName = (): string => {
    return socket.data.user?.name || 'Participant';
  };

  const assertSocketAuthorizedForBoard = (
    boardId: string
  ): { session: WhiteboardSession; userId: string } => {
    const userId = getUserId();
    if (!userId) {
      throw new Error('Authentication required');
    }

    const session = activeSessions.get(boardId);
    if (!session) {
      throw new Error('Whiteboard session not active');
    }

    const joinedBoards = socketBoardsMap.get(socket.id);
    if (!joinedBoards || !joinedBoards.has(boardId) || !session.activeUsers.has(socket.id)) {
      throw new Error('Unauthorized: Socket has not joined this whiteboard room');
    }

    return { session, userId };
  };

  socket.on(
    'whiteboard:join',
    async (
      data: { boardId: string; meetingCode?: string },
      ack?: (res: { success: boolean; data?: any; message?: string }) => void
    ) => {
      try {
        const userId = getUserId();
        if (!userId) {
          ack?.({ success: false, message: 'Authentication required' });
          return;
        }

        const { boardId, meetingCode } = data || {};
        if (!boardId) {
          ack?.({ success: false, message: 'boardId is required' });
          return;
        }

        const rateLimitKey = `${userId}:${socket.id}`;
        if (!checkJoinRateLimit(rateLimitKey)) {
          ack?.({ success: false, message: 'Too many join attempts. Please slow down.' });
          return;
        }

        let targetOrgId: string | null = null;
        const existingSession = activeSessions.get(boardId);
        if (existingSession) {
          targetOrgId = existingSession.organizationId;
        } else {
          const boardMeta = await prisma.whiteboard.findUnique({
            where: { id: boardId },
            select: { organizationId: true },
          });
          if (!boardMeta) {
            ack?.({ success: false, message: 'Whiteboard not found' });
            return;
          }
          targetOrgId = boardMeta.organizationId;
        }

        await assertUserBelongsToOrganization(userId, targetOrgId);

        let meetingToLink: any = null;
        if (meetingCode) {
          const meeting = await findMeetingByCodeOrId(meetingCode);
          await assertUserCanAccessMeeting(userId, meeting);

          if (meeting.organizationId && meeting.organizationId !== targetOrgId) {
            ack?.({
              success: false,
              message: 'Meeting and whiteboard do not belong to the same organization',
            });
            return;
          }

          if (!meeting.organizationId) {
            if (meeting.hostId !== userId) {
              ack?.({
                success: false,
                message: 'Only the meeting host can assign an organization to this meeting',
              });
              return;
            }
          }

          meetingToLink = meeting;
        }

        const session = await getOrCreateSession(boardId);

        if (meetingToLink) {
          if (!meetingToLink.organizationId) {
            await prisma.$transaction(async (tx) => {
              await tx.meeting.update({
                where: { id: meetingToLink.id },
                data: { organizationId: session.organizationId },
              });

              await tx.whiteboardMeeting.upsert({
                where: {
                  whiteboardId_meetingId: {
                    whiteboardId: boardId,
                    meetingId: meetingToLink.id,
                  },
                },
                create: {
                  whiteboardId: boardId,
                  meetingId: meetingToLink.id,
                },
                update: {},
              });
            });
          } else {
            await prisma.whiteboardMeeting.upsert({
              where: {
                whiteboardId_meetingId: {
                  whiteboardId: boardId,
                  meetingId: meetingToLink.id,
                },
              },
              create: {
                whiteboardId: boardId,
                meetingId: meetingToLink.id,
              },
              update: {},
            });
          }
        }

        const roomName = `whiteboard:${boardId}`;
        socket.join(roomName);

        let boards = socketBoardsMap.get(socket.id);
        if (!boards) {
          boards = new Set();
          socketBoardsMap.set(socket.id, boards);
        }
        boards.add(boardId);

        session.activeUsers.set(socket.id, {
          userId,
          name: getUserName(),
        });

        try {
          await redis.hset(
            getBoardUsersKey(boardId),
            socket.id,
            JSON.stringify({ userId, name: getUserName() })
          );
          await redis.expire(getBoardUsersKey(boardId), REDIS_BOARD_TTL);
        } catch (err: any) {
          logger.warn(`[Whiteboard Socket] Redis user track error: ${err.message}`);
        }

        logger.info(
          `[Whiteboard Socket] User ${userId} (${getUserName()}) joined board ${boardId}. Local users: ${session.activeUsers.size}`
        );

        socket.to(roomName).emit('whiteboard:user-joined', {
          socketId: socket.id,
          user: {
            id: userId,
            name: getUserName(),
          },
        });

        let clusterUsers = Array.from(session.activeUsers.values());
        try {
          const rawUsers = await redis.hgetall(getBoardUsersKey(boardId));
          if (rawUsers && Object.keys(rawUsers).length > 0) {
            clusterUsers = Object.values(rawUsers)
              .map((u) => {
                try {
                  return JSON.parse(u);
                } catch {
                  return null;
                }
              })
              .filter(Boolean);
          }
        } catch {}

        const initialPayload = {
          boardId,
          elements: Array.from(session.elements.values()),
          viewState: session.viewState,
          activeUsers: clusterUsers,
        };

        ack?.({
          success: true,
          data: initialPayload,
        });
      } catch (err: any) {
        logger.error(`[Whiteboard Socket] Error joining whiteboard: ${err.message}`);
        ack?.({ success: false, message: err.message });
      }
    }
  );

  socket.on(
    'whiteboard:draw-element',
    async (
      rawPayload: unknown,
      ack?: (res: { success: boolean; message?: string }) => void
    ) => {
      try {
        const validated = socketDrawElementSchema.safeParse(rawPayload);
        if (!validated.success) {
          ack?.({ success: false, message: validated.error.issues[0]?.message || 'Invalid payload' });
          return;
        }

        const { boardId, element } = validated.data;
        const { session, userId } = assertSocketAuthorizedForBoard(boardId);

        await executeWithBoardLock(boardId, async (checkLock) => {
          if (!session.elements.has(element.id) && session.elements.size >= 5000) {
            throw new Error('Board element limit of 5000 reached');
          }

          const enrichedElement = {
            ...element,
            lastModifiedBy: userId,
            updatedAt: Date.now(),
          };

          await checkLock();

          session.elements.set(element.id, enrichedElement);
          session.version++;
          session.hasUnsyncedLocalChanges = true;

          try {
            const pipeline = redis.pipeline();
            pipeline.hset(getBoardElementsKey(boardId), element.id, JSON.stringify(enrichedElement));
            pipeline.del(getBoardClearedKey(boardId));
            pipeline.incr(getBoardVersionKey(boardId));
            pipeline.expire(getBoardElementsKey(boardId), REDIS_BOARD_TTL);
            pipeline.expire(getBoardVersionKey(boardId), REDIS_BOARD_TTL);
            const results = await pipeline.exec();
            if (isPipelineSuccessful(results)) {
              session.hasUnsyncedLocalChanges = false;
            } else {
              session.hasUnsyncedLocalChanges = true;
              logger.warn(`[Whiteboard Socket] Redis pipeline error during element sync on board ${boardId}`);
            }
          } catch (err: any) {
            session.hasUnsyncedLocalChanges = true;
            logger.warn(`[Whiteboard Socket] Redis element sync error: ${err.message}`);
          }

          scheduleDebouncedSave(session);

          await checkLock();

          socket.to(`whiteboard:${boardId}`).emit('whiteboard:element-updated', {
            element: enrichedElement,
            updatedBy: userId,
          });
        });

        ack?.({ success: true });
      } catch (err: any) {
        ack?.({ success: false, message: err.message });
      }
    }
  );

  socket.on(
    'whiteboard:elements-change',
    async (
      rawPayload: unknown,
      ack?: (res: { success: boolean; message?: string }) => void
    ) => {
      try {
        const validated = socketElementsChangeSchema.safeParse(rawPayload);
        if (!validated.success) {
          ack?.({ success: false, message: validated.error.issues[0]?.message || 'Invalid payload' });
          return;
        }

        const { boardId, updates, deletes } = validated.data;
        const { session, userId } = assertSocketAuthorizedForBoard(boardId);

        await executeWithBoardLock(boardId, async (checkLock) => {
          let newElementsCount = 0;
          if (Array.isArray(updates)) {
            for (const el of updates) {
              if (!session.elements.has(el.id)) {
                newElementsCount++;
              }
            }
          }
          const deleteCount = Array.isArray(deletes)
            ? deletes.filter((id) => session.elements.has(id)).length
            : 0;
          if (session.elements.size + newElementsCount - deleteCount > 5000) {
            throw new Error('Board element limit of 5000 reached');
          }

          await checkLock();

          session.version++;
          session.hasUnsyncedLocalChanges = true;

          try {
            const pipeline = redis.pipeline();

            if (Array.isArray(updates)) {
              for (const el of updates) {
                if (el && el.id) {
                  const enriched = {
                    ...el,
                    lastModifiedBy: userId,
                    updatedAt: Date.now(),
                  };
                  session.elements.set(el.id, enriched);
                  pipeline.hset(getBoardElementsKey(boardId), el.id, JSON.stringify(enriched));
                }
              }
              if (updates.length > 0) {
                pipeline.del(getBoardClearedKey(boardId));
              }
            }

            if (Array.isArray(deletes)) {
              for (const id of deletes) {
                session.elements.delete(id);
                pipeline.hdel(getBoardElementsKey(boardId), id);
              }
            }

            pipeline.incr(getBoardVersionKey(boardId));
            pipeline.expire(getBoardElementsKey(boardId), REDIS_BOARD_TTL);
            pipeline.expire(getBoardVersionKey(boardId), REDIS_BOARD_TTL);
            const results = await pipeline.exec();
            if (isPipelineSuccessful(results)) {
              session.hasUnsyncedLocalChanges = false;
            } else {
              session.hasUnsyncedLocalChanges = true;
              logger.warn(`[Whiteboard Socket] Redis pipeline error during batch sync on board ${boardId}`);
            }
          } catch (err: any) {
            session.hasUnsyncedLocalChanges = true;
            logger.warn(`[Whiteboard Socket] Redis batch elements sync error: ${err.message}`);
          }

          scheduleDebouncedSave(session);

          await checkLock();

          socket.to(`whiteboard:${boardId}`).emit('whiteboard:elements-changed', {
            updates,
            deletes,
            updatedBy: userId,
          });
        });

        ack?.({ success: true });
      } catch (err: any) {
        ack?.({ success: false, message: err.message });
      }
    }
  );

  socket.on(
    'whiteboard:clear',
    async (
      data: { boardId: string },
      ack?: (res: { success: boolean; message?: string }) => void
    ) => {
      try {
        const { boardId } = data || {};
        if (!boardId || typeof boardId !== 'string') {
          ack?.({ success: false, message: 'boardId required' });
          return;
        }

        const { session, userId } = assertSocketAuthorizedForBoard(boardId);

        await executeWithBoardLock(boardId, async (checkLock) => {
          await checkLock();

          session.elements.clear();
          session.version++;
          session.hasUnsyncedLocalChanges = true;

          try {
            const pipeline = redis.pipeline();
            pipeline.del(getBoardElementsKey(boardId));
            pipeline.set(getBoardClearedKey(boardId), '1', 'EX', REDIS_BOARD_TTL);
            pipeline.incr(getBoardVersionKey(boardId));
            pipeline.expire(getBoardVersionKey(boardId), REDIS_BOARD_TTL);
            const results = await pipeline.exec();
            if (isPipelineSuccessful(results)) {
              session.hasUnsyncedLocalChanges = false;
            } else {
              session.hasUnsyncedLocalChanges = true;
              logger.warn(`[Whiteboard Socket] Redis pipeline error during clear sync on board ${boardId}`);
            }
          } catch (err: any) {
            session.hasUnsyncedLocalChanges = true;
            logger.warn(`[Whiteboard Socket] Redis clear sync error: ${err.message}`);
          }

          scheduleDebouncedSave(session);

          await checkLock();

          socket.to(`whiteboard:${boardId}`).emit('whiteboard:cleared', {
            clearedBy: userId,
          });
        });

        ack?.({ success: true });
      } catch (err: any) {
        ack?.({ success: false, message: err.message });
      }
    }
  );

  socket.on(
    'whiteboard:view-state',
    async (
      rawPayload: unknown,
      ack?: (res: { success: boolean; message?: string }) => void
    ) => {
      try {
        const validated = socketViewStatePayloadSchema.safeParse(rawPayload);
        if (!validated.success) {
          ack?.({ success: false, message: validated.error.issues[0]?.message || 'Invalid payload' });
          return;
        }

        const { boardId, viewState } = validated.data;
        const { session } = assertSocketAuthorizedForBoard(boardId);

        await executeWithBoardLock(boardId, async (checkLock) => {
          await checkLock();

          session.viewState = { ...session.viewState, ...viewState };
          session.version++;
          session.hasUnsyncedLocalChanges = true;

          try {
            const pipeline = redis.pipeline();
            pipeline.set(
              getBoardViewStateKey(boardId),
              JSON.stringify(session.viewState),
              'EX',
              REDIS_BOARD_TTL
            );
            pipeline.incr(getBoardVersionKey(boardId));
            pipeline.expire(getBoardVersionKey(boardId), REDIS_BOARD_TTL);
            const results = await pipeline.exec();
            if (isPipelineSuccessful(results)) {
              session.hasUnsyncedLocalChanges = false;
            } else {
              session.hasUnsyncedLocalChanges = true;
              logger.warn(`[Whiteboard Socket] Redis pipeline error during viewState sync on board ${boardId}`);
            }
          } catch (err: any) {
            session.hasUnsyncedLocalChanges = true;
            logger.warn(`[Whiteboard Socket] Redis viewState sync error: ${err.message}`);
          }

          scheduleDebouncedSave(session);

          await checkLock();

          socket.to(`whiteboard:${boardId}`).emit('whiteboard:view-state', {
            boardId,
            viewState: session.viewState,
          });
        });

        ack?.({ success: true });
      } catch (err: any) {
        ack?.({ success: false, message: err.message });
      }
    }
  );

  socket.on(
    'whiteboard:cursor-move',
    (data: unknown) => {
      try {
        const validated = socketCursorMoveSchema.safeParse(data);
        if (!validated.success) return;

        const { boardId, x, y } = validated.data;
        const now = Date.now();
        const lastTime = lastCursorBroadcastMap.get(boardId) || 0;
        if (now - lastTime < CURSOR_THROTTLE_MS) {
          return;
        }

        const { userId } = assertSocketAuthorizedForBoard(boardId);
        lastCursorBroadcastMap.set(boardId, now);
        const userName = getUserName();

        socket.to(`whiteboard:${boardId}`).emit('whiteboard:cursor-moved', {
          socketId: socket.id,
          userId,
          name: userName,
          x,
          y,
        });
      } catch {}
    }
  );

  const handleLeaveBoard = async (boardId: string) => {
    lastCursorBroadcastMap.delete(boardId);
    const roomName = `whiteboard:${boardId}`;
    socket.leave(roomName);

    const joinedBoards = socketBoardsMap.get(socket.id);
    if (joinedBoards) {
      joinedBoards.delete(boardId);
      if (joinedBoards.size === 0) {
        socketBoardsMap.delete(socket.id);
      }
    }

    try {
      await redis.hdel(getBoardUsersKey(boardId), socket.id);
    } catch {}

    const session = activeSessions.get(boardId);
    if (session) {
      session.activeUsers.delete(socket.id);

      socket.to(roomName).emit('whiteboard:user-left', {
        socketId: socket.id,
        userId: getUserId(),
      });

      let remainingClusterUsers = session.activeUsers.size;
      try {
        remainingClusterUsers = await redis.hlen(getBoardUsersKey(boardId));
      } catch {}

      if (remainingClusterUsers === 0) {
        if (!session.isSaving) {
          const saved = await flushBoardToDatabase(boardId);

          if (saved && session.version === session.lastSavedVersion) {
            activeSessions.delete(boardId);
            logger.info(
              `[Whiteboard Socket] Room ${boardId} is empty across cluster. State flushed to DB and session released.`
            );
          } else {
            logger.warn(
              `[Whiteboard Socket] Room ${boardId} is empty but has pending/unwritten state; retaining in memory for retry.`
            );
          }
        } else {
          logger.info(
            `[Whiteboard Socket] Room ${boardId} is empty with save in-flight; will be released upon save completion.`
          );
        }
      }
    }
  };

  socket.on('whiteboard:leave', (data: { boardId?: string }) => {
    if (data?.boardId) {
      handleLeaveBoard(data.boardId);
    } else {
      const boards = socketBoardsMap.get(socket.id);
      if (boards) {
        for (const bId of Array.from(boards)) {
          handleLeaveBoard(bId);
        }
      }
    }
  });

  socket.on('disconnect', () => {
    const boards = socketBoardsMap.get(socket.id);
    if (boards) {
      for (const bId of Array.from(boards)) {
        handleLeaveBoard(bId);
      }
    }
  });
};

export const coordinatedUpdateWhiteboard = async (
  userId: string,
  boardId: string,
  input: UpdateWhiteboardInput
) => {

  const localMutex = getBoardLocalLock(boardId);
  const releaseLocalLock = await localMutex.acquire();

  let redisLockAcquired = false;
  let lockLost = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  const lockKey = getBoardLockKey(boardId);
  const lockVal = `rest-${process.pid}-${Date.now()}-${Math.random()}`;

  try {

    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await redis.set(lockKey, lockVal, 'PX', LOCK_TTL_MS, 'NX');
        if (res === 'OK') {
          redisLockAcquired = true;
          break;
        }
      } catch (err: any) {
        logger.warn(
          `[Whiteboard REST] Redis distributed lock unavailable, operating with process-local mutex fallback: ${err.message}`
        );
        redisLockAcquired = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (!redisLockAcquired) {
      const isSingleInstance = process.env.SINGLE_INSTANCE === 'true';
      if (!isSingleInstance) {
        throw new ApiError(
          409,
          'Whiteboard is currently locked by another operation. Please try again.'
        );
      }
    }

    if (redisLockAcquired) {
      heartbeatTimer = setInterval(async () => {
        try {
          const renewed = await redis.eval(RENEW_LOCK_SCRIPT, 1, lockKey, lockVal, LOCK_TTL_MS);
          if (renewed !== 1) {
            lockLost = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        } catch {

        }
      }, LOCK_HEARTBEAT_MS);
    }

    const session = activeSessions.get(boardId);
    if (session?.saveTimer) {
      clearTimeout(session.saveTimer);
      session.saveTimer = null;
    }

    let rawContent = input.content;
    let elementsArray: any[] = [];
    let viewState: any = { zoom: 1, scrollX: 0, scrollY: 0, backgroundColor: '#ffffff' };
    let clientProvidedVersion: number | null = null;

    if (rawContent && typeof rawContent === 'object') {
      if (Array.isArray(rawContent)) {
        elementsArray = rawContent;
      } else {
        const contentObj = rawContent as any;
        if (Array.isArray(contentObj.elements)) {
          elementsArray = contentObj.elements;
        }
        if (contentObj.viewState && typeof contentObj.viewState === 'object') {
          viewState = { ...viewState, ...contentObj.viewState };
        } else if (session?.viewState) {
          viewState = { ...session.viewState };
        }
        if (typeof contentObj._version === 'number') {
          clientProvidedVersion = contentObj._version;
        }
      }
    }

    let currentRedisVersion = 0;
    try {
      const verStr = await redis.get(getBoardVersionKey(boardId));
      if (verStr) {
        currentRedisVersion = parseInt(verStr, 10) || 0;
      }
    } catch {}

    const localVersion = session?.version || 0;

    if (redisLockAcquired) {
      if (lockLost) {
        throw new ApiError(
          409,
          'Distributed lock renewal was lost. Please retry the update.'
        );
      }
      let currentLockVal: string | null = null;
      try {
        currentLockVal = await redis.get(lockKey);
      } catch {}
      if (currentLockVal !== lockVal) {
        lockLost = true;
        throw new ApiError(
          409,
          'Distributed lock ownership was lost to another process. Please retry the update.'
        );
      }
    }

    let updatedWhiteboard: any = null;
    let nextVersion = 1;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`whiteboard:${boardId}`}))`;

      if (redisLockAcquired) {
        if (lockLost) {
          throw new ApiError(
            409,
            'Distributed lock was lost prior to committing. Please retry the update.'
          );
        }
        let checkVal: string | null = null;
        try {
          checkVal = await redis.get(lockKey);
        } catch {}
        if (checkVal !== lockVal) {
          lockLost = true;
          throw new ApiError(
            409,
            'Distributed lock ownership was lost prior to committing. Please retry the update.'
          );
        }
      }

      const currentBoard = await tx.whiteboard.findUnique({
        where: { id: boardId },
        select: { content: true },
      });

      let currentDbVersion = 0;
      if (currentBoard && currentBoard.content && typeof currentBoard.content === 'object') {
        const c = currentBoard.content as any;
        if (typeof c._version === 'number') {
          currentDbVersion = c._version;
        }
      }

      if (clientProvidedVersion !== null && clientProvidedVersion < currentDbVersion) {
        throw new ApiError(
          409,
          `Conflict: Whiteboard has been modified (persisted v${currentDbVersion} > provided v${clientProvidedVersion}). Please reload and retry.`
        );
      }

      const baseVersion = Math.max(
        currentDbVersion,
        currentRedisVersion,
        localVersion,
        clientProvidedVersion || 0
      );
      nextVersion = baseVersion + 1;

      const payloadWithVersion: Prisma.InputJsonObject = {
        elements: elementsArray,
        viewState,
        _version: nextVersion,
      };

      const updateData: Prisma.WhiteboardUpdateInput = {
        content: payloadWithVersion,
      };
      if (input.name !== undefined) {
        updateData.name = input.name;
      }

      updatedWhiteboard = await tx.whiteboard.update({
        where: { id: boardId },
        data: updateData,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
      });
    });

    let redisSyncSucceeded = false;
    try {
      const pipeline = redis.pipeline();
      pipeline.del(getBoardElementsKey(boardId));
      if (elementsArray.length > 0) {
        for (const el of elementsArray) {
          if (el && typeof el === 'object') {
            const elId = el.id || `el-${Math.random()}`;
            pipeline.hset(getBoardElementsKey(boardId), elId, JSON.stringify(el));
          }
        }
        pipeline.del(getBoardClearedKey(boardId));
        pipeline.expire(getBoardElementsKey(boardId), REDIS_BOARD_TTL);
      } else {
        pipeline.set(getBoardClearedKey(boardId), '1', 'EX', REDIS_BOARD_TTL);
      }

      pipeline.set(getBoardViewStateKey(boardId), JSON.stringify(viewState), 'EX', REDIS_BOARD_TTL);
      pipeline.set(getBoardVersionKey(boardId), nextVersion.toString(), 'EX', REDIS_BOARD_TTL);
      pipeline.set(getBoardLastSavedKey(boardId), nextVersion.toString(), 'EX', REDIS_BOARD_TTL);
      const pipelineResults = await pipeline.exec();
      if (isPipelineSuccessful(pipelineResults)) {
        redisSyncSucceeded = true;
      } else {
        logger.warn(`[Whiteboard REST] Redis pipeline error during coordinated update on board ${boardId}`);
      }
    } catch (redisErr: any) {
      logger.warn(`[Whiteboard REST] Error synchronizing Redis after REST update: ${redisErr.message}`);
    }

    if (session) {
      session.elements.clear();
      for (const el of elementsArray) {
        if (el && el.id) {
          session.elements.set(el.id, el);
        }
      }
      session.viewState = viewState;
      session.version = nextVersion;
      session.lastSavedVersion = nextVersion;
      session.isSaving = false;
      if (redisSyncSucceeded) {
        session.hasUnsyncedLocalChanges = false;
        session.needsReconciliation = false;
      } else {
        session.hasUnsyncedLocalChanges = true;
        session.needsReconciliation = true;
        scheduleDebouncedSave(session);
      }
    } else if (!redisSyncSucceeded) {
      setImmediate(() => {
        flushBoardToDatabase(boardId).catch(() => {});
      });
    }

    try {
      const io = getIO();
      if (elementsArray.length === 0) {
        io.to(`whiteboard:${boardId}`).emit('whiteboard:cleared', { clearedBy: userId });
      } else {
        io.to(`whiteboard:${boardId}`).emit('whiteboard:elements-changed', {
          updates: elementsArray,
          deletes: [],
          updatedBy: userId,
        });
      }
      io.to(`whiteboard:${boardId}`).emit('whiteboard:view-state', {
        boardId,
        viewState,
      });
    } catch {}

    logger.info(
      `[Whiteboard REST] Successfully coordinated REST update for board ${boardId} (elements: ${elementsArray.length}).`
    );

    return updatedWhiteboard;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (redisLockAcquired && !lockLost) {
      const unlockScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await redis.eval(unlockScript, 1, lockKey, lockVal);
      } catch {}
    }
    releaseLocalLock();
  }
};
