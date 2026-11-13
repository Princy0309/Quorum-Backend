import { Queue, Worker, Job } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import prisma from '../config/prisma.js';
import { getIO } from '../sockets/socketServer.js';
import { sendPushToOfflineUsers } from '../services/notificationService.js';
import logger from '../utils/logger.js';

export const reminderRedisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const reminderQueue = new Queue('reminderQueue', {
  connection: reminderRedisConnection,
});

export interface ReminderJobData {
  eventId: string;
  userId: string;
}

export const scheduleEventReminder = async (event: {
  id: string;
  userId: string;
  startDate: Date;
  hasReminder: boolean;
  reminderMinutes: number;
}) => {
  if (!event.hasReminder) {
    await cancelEventReminder(event.id);
    return;
  }

  const reminderTime = new Date(event.startDate.getTime() - event.reminderMinutes * 60 * 1000);
  const delay = reminderTime.getTime() - Date.now();

  if (delay <= 0) {
    await cancelEventReminder(event.id);
    return;
  }

  const jobId = `reminder-${event.id}`;

  try {
    const existingJob = await reminderQueue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }

    await reminderQueue.add(
      'sendEventReminder',
      { eventId: event.id, userId: event.userId },
      {
        delay,
        jobId,
        removeOnComplete: true,
        removeOnFail: 50,
      }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not schedule BullMQ reminder for event ${event.id}: ${msg}`);
  }
};

export const cancelEventReminder = async (eventId: string) => {
  const jobId = `reminder-${eventId}`;
  try {
    const existingJob = await reminderQueue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not cancel BullMQ reminder for event ${eventId}: ${msg}`);
  }
};

export const reminderWorker = new Worker(
  'reminderQueue',
  async (job: Job<ReminderJobData>) => {
    const { eventId, userId } = job.data;

    const notif = await prisma.$transaction(async (tx) => {
      const currentEvent = await tx.calendarEvent.findUnique({
        where: { id: eventId },
      });

      if (!currentEvent || !currentEvent.hasReminder || currentEvent.isNotified) {
        return null;
      }

      if (currentEvent.eventType === 'MEETING' && currentEvent.meetingLink) {
        const match = currentEvent.meetingLink.match(/\/meet\/([^\/?#]+)/);
        if (match && match[1]) {
          const meeting = await tx.meeting.findFirst({
            where: { code: match[1] },
            select: { status: true }
          });
          if (meeting && (meeting.status === 'ENDED' || meeting.status === 'CANCELLED')) {
            await tx.calendarEvent.update({
              where: { id: eventId },
              data: { hasReminder: false, isNotified: true }
            });
            return null;
          }
        }
      }

      await tx.calendarEvent.update({
        where: { id: eventId },
        data: { isNotified: true },
      });

      return await tx.notification.create({
        data: {
          recipientId: userId,
          actorId: userId,
          type: 'EVENT_REMINDER',
          title: `Upcoming Event: ${currentEvent.title}`,
          body: `Starts in ${currentEvent.reminderMinutes} minutes`,
          data: {
            eventId: currentEvent.id,
            meetingLink: currentEvent.meetingLink || '',
            startDate: currentEvent.startDate.toISOString(),
          },
        },
      });
    });

    if (!notif) {
      return;
    }

    const notifData = (notif.data as any) || {};

    try {
      const io = getIO();
      io.to(`user:${userId}`).emit('notification:new', notif);
    } catch (socketErr: unknown) {
      const msg = socketErr instanceof Error ? socketErr.message : String(socketErr);
      logger.warn(`Could not emit real-time reminder socket event: ${msg}`);
    }

    sendPushToOfflineUsers(
      [userId],
      notif.title,
      notif.body,
      {
        type: 'EVENT_REMINDER',
        meetingLink: notifData.meetingLink || '',
        title: notif.title,
        eventId: eventId,
        startDate: notifData.startDate || ''
      },
      {
        channelId: 'quorum_chat_messages',
        sound: 'default',
        tag: eventId
      }
    ).catch((pushErr) => {
      logger.warn('Failed to send reminder push notification', pushErr);
    });
  },
  {
    connection: reminderRedisConnection,
    concurrency: 5,
  }
);

reminderWorker.on('failed', (job, err) => {
  logger.error(`[ReminderWorker] Job ${job?.id} failed:`, err);
});
