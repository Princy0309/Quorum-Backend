import prisma from '../config/prisma.js';
import { sendFCMNotification } from '../config/firebase.js';
import { getMultipleUserPresences } from './presenceService.js';
import logger from '../utils/logger.js';
import type { 
  GetNotificationsOptions,
  PaginatedNotificationsResult 
} from '../types/index.js';

export const getUserNotifications = async (
  userId: string, 
  options: GetNotificationsOptions = {}
): Promise<PaginatedNotificationsResult> => {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
  const skip = (page - 1) * limit;

  const whereClause: any = { recipientId: userId };
  if (options.unreadOnly) {
    whereClause.isRead = false;
  }

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    }),
    prisma.notification.count({ where: whereClause }),
    prisma.notification.count({ where: { recipientId: userId, isRead: false } }),
  ]);

  return {
    notifications,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    unreadCount,
  };
};

export const markNotificationAsRead = async (userId: string, notificationId: string) => {
  return await prisma.notification.updateMany({
    where: {
      id: notificationId,
      recipientId: userId,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
};

export const markAllNotificationsAsRead = async (userId: string) => {
  return await prisma.notification.updateMany({
    where: {
      recipientId: userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
};

export const deleteNotification = async (userId: string, notificationId: string) => {
  return await prisma.notification.deleteMany({
    where: {
      id: notificationId,
      recipientId: userId,
    },
  });
};

export const getUnreadNotificationCount = async (userId: string) => {
  return await prisma.notification.count({
    where: {
      recipientId: userId,
      isRead: false,
    },
  });
};

export const registerDeviceToken = async (userId: string, token: string, platform: string = 'web') => {
  return await prisma.deviceToken.upsert({
    where: { token },
    update: { userId, platform, updatedAt: new Date() },
    create: { userId, token, platform },
  });
};

export const unregisterDeviceToken = async (userId: string, token: string) => {
  return await prisma.deviceToken.deleteMany({
    where: { userId, token },
  });
};

export const sendPushToOfflineUsers = async (
  recipientUserIds: string[],
  title: string,
  body: string,
  payloadData?: Record<string, string>
) => {
  if (!recipientUserIds || recipientUserIds.length === 0) return;

  const presenceMap = await getMultipleUserPresences(recipientUserIds);
  const offlineUserIds = recipientUserIds.filter((id) => !presenceMap.get(id)?.isOnline);

  if (offlineUserIds.length === 0) return;

  const devices = await prisma.deviceToken.findMany({
    where: { userId: { in: offlineUserIds } },
    select: { token: true },
  });

  const tokens = devices.map((d) => d.token);
  if (tokens.length === 0) return;

  const result = await sendFCMNotification({
    tokens,
    title,
    body,
    data: payloadData,
  });

  if (result.invalidTokens && result.invalidTokens.length > 0) {
    logger.info('Pruning invalid FCM tokens from database', { count: result.invalidTokens.length });
    await prisma.deviceToken.deleteMany({
      where: { token: { in: result.invalidTokens } },
    });
  }
};
