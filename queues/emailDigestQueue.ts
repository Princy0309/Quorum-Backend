import { Queue, Worker, Job } from 'bullmq';
import { queueRedisConnection } from './emailQueue.js';
import prisma from '../config/prisma.js';
import { sendNotificationDigestEmail } from '../services/emailService.js';
import logger from '../utils/logger.js';

export const emailDigestQueue = new Queue('emailDigestQueue', {
  connection: queueRedisConnection,
});

export const queueEmailDigest = async (userId: string) => {
  const jobId = `digest:${userId}`;
  try {
    await emailDigestQueue.add(
      'send-digest',
      { userId },
      {
        jobId,
        delay: 5 * 60 * 1000,
        removeOnComplete: true,
        removeOnFail: 100,
      }
    );
  } catch (err: any) {
    logger.debug('[EmailDigestQueue] Digest job already scheduled', { userId });
  }
};

const workerRedisConnection = queueRedisConnection.duplicate();

export const emailDigestWorker = new Worker(
  'emailDigestQueue',
  async (job: Job<{ userId: string }>) => {
    const { userId } = job.data;
    logger.info(`[EmailDigestWorker] Checking digest for user ${userId}`);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    if (!user || !user.email) {
      return null;
    }

    const unreadNotifications = await prisma.notification.findMany({
      where: {
        recipientId: userId,
        isRead: false,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        body: true,
        createdAt: true,
      },
    });

    if (unreadNotifications.length === 0) {
      logger.info(`[EmailDigestWorker] User ${userId} has no unread notifications. Skipping email.`);
      return null;
    }

    try {
      await sendNotificationDigestEmail(
        user.email,
        user.name,
        unreadNotifications
      );
      logger.info(`[EmailDigestWorker] Sent digest email to ${user.email} with ${unreadNotifications.length} items`);
    } catch (err: any) {
      logger.error(`[EmailDigestWorker] Failed to send digest email to ${user.email}`, { error: err.message });
      throw err;
    }

    return { sent: true, count: unreadNotifications.length };
  },
  {
    connection: workerRedisConnection,
    concurrency: 5,
  }
);

emailDigestWorker.on('completed', (job) => {
  logger.info(`[EmailDigestWorker] Job #${job.id} completed.`);
});

emailDigestWorker.on('failed', (job, err) => {
  logger.error(`[EmailDigestWorker] Job #${job?.id} failed with error:`, { error: err.message });
});
