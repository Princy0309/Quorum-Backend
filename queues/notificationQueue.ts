import { Queue, Worker, Job } from 'bullmq';
import { queueRedisConnection } from './emailQueue.js';
import prisma from '../config/prisma.js';
import { getIO } from '../sockets/socketServer.js';
import { sendPushToOfflineUsers } from '../services/notificationService.js';
import { getMultipleUserPresences } from '../services/presenceService.js';
import logger from '../utils/logger.js';
import type { CreateNotificationInput } from '../types/index.js';

export const notificationQueue = new Queue('notificationQueue', {
  connection: queueRedisConnection,
});

export const queueNotification = async (payload: CreateNotificationInput) => {
  if (!payload.recipientId || !payload.title || !payload.body || !payload.type) {
    logger.warn('[NotificationQueue] Skipping invalid payload', { payload });
    return null;
  }

  if (payload.actorId && payload.actorId === payload.recipientId) {
    return null;
  }

  return await notificationQueue.add('dispatch-notification', payload, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: 500,
  });
};

const workerRedisConnection = queueRedisConnection.duplicate();

export const notificationWorker = new Worker(
  'notificationQueue',
  async (job: Job<CreateNotificationInput>) => {
    const { recipientId, actorId, type, title, body, data } = job.data;

    if (actorId && actorId === recipientId) {
      return null;
    }

    logger.info(`[NotificationWorker] Processing job #${job.id} for user ${recipientId}`);

    let notification;
    try {
      notification = await prisma.notification.create({
        data: {
          recipientId,
          actorId: actorId || null,
          type,
          title,
          body,
          data: data ? data : undefined,
        },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      });
    } catch (dbErr: any) {
      logger.error(`[NotificationWorker] DB insert failed for job #${job.id}: ${dbErr.message}`);
      throw dbErr;
    }

    let isOnline = false;
    try {
      const presenceMap = await getMultipleUserPresences([recipientId]);
      isOnline = !!presenceMap.get(recipientId)?.isOnline;
    } catch (err: any) {
      logger.warn('[NotificationWorker] Presence check failed', { error: err.message });
    }

    if (isOnline) {
      try {
        const io = getIO();
        io.to(`user:${recipientId}`).emit('notification:new', notification);
        logger.info(`[NotificationWorker] Emitted WebSocket alert to user:${recipientId}`);
      } catch (socketErr: any) {
        logger.debug('[NotificationWorker] Socket broadcast skipped', { error: socketErr.message });
      }
    } else {
      try {
        const stringifiedData: Record<string, string> = { type };
        if (data && typeof data === 'object') {
          for (const [key, value] of Object.entries(data)) {
            stringifiedData[key] = typeof value === 'string' ? value : JSON.stringify(value);
          }
        }

        await sendPushToOfflineUsers([recipientId], title, body, stringifiedData);
        logger.info(`[NotificationWorker] Dispatched FCM push to user:${recipientId}`);
      } catch (pushErr: any) {
        logger.warn('[NotificationWorker] FCM push dispatch failed', { error: pushErr.message });
      }
    }

    return notification;
  },
  {
    connection: workerRedisConnection,
    concurrency: 5,
  }
);

notificationWorker.on('completed', (job) => {
  logger.info(`[NotificationWorker] Job #${job.id} completed successfully.`);
});

notificationWorker.on('failed', (job, err) => {
  logger.error(`[NotificationWorker] Job #${job?.id} failed with error:`, { error: err.message });
});
