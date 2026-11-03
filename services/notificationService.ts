import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { sendFCMNotification, PushPayload } from '../config/firebase.js';
import { getMultipleUserPresences } from './presenceService.js';
import logger from '../utils/logger.js';
import type { 
  GetNotificationsOptions,
  PaginatedNotificationsResult,
  UpdateNotificationPreferenceInput
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

export interface SendPushOptions {
  payloadData?: Record<string, string>;
  conversationId?: string;
  badge?: number;
  sound?: string;
  channelId?: string;
  category?: string;
  imageUrl?: string;
  forcePush?: boolean;
}

export const sendPushNotification = async (
  recipientUserIds: string[],
  title: string,
  body: string,
  options?: SendPushOptions
) => {
  if (!recipientUserIds || recipientUserIds.length === 0) return;

  let targetUserIds = recipientUserIds;

  if (!options?.forcePush) {
    const presenceMap = await getMultipleUserPresences(recipientUserIds);
    const appStateKeys = recipientUserIds.map((id) => `user_app_state:${id}`);
    const appStates = await redis.mget(...appStateKeys);

    targetUserIds = recipientUserIds.filter((id, idx) => {
      const isOnline = !!presenceMap.get(id)?.isOnline;
      const appState = appStates[idx];
      return !isOnline || appState === 'background';
    });
  }

  if (targetUserIds.length === 0) return;

  const devices = await prisma.deviceToken.findMany({
    where: { userId: { in: targetUserIds } },
    select: { token: true, userId: true, platform: true },
  });

  if (devices.length === 0) return;

  const tokens = devices.map((d) => d.token);

  let badge = options?.badge;
  if (badge === undefined && targetUserIds.length === 1) {
    badge = await getUnreadNotificationCount(targetUserIds[0]);
  }

  const result = await sendFCMNotification({
    tokens,
    title,
    body,
    data: options?.payloadData,
    badge,
    sound: options?.sound || 'default',
    channelId: options?.channelId || 'quorum_chat_messages',
    conversationId: options?.conversationId,
    category: options?.category || 'MESSAGE_REPLY',
    imageUrl: options?.imageUrl,
    priority: 'high',
  });

  if (result.invalidTokens && result.invalidTokens.length > 0) {
    logger.info('Pruning invalid FCM tokens from database', { count: result.invalidTokens.length });
    await prisma.deviceToken.deleteMany({
      where: { token: { in: result.invalidTokens } },
    });
  }
};

export const sendPushToOfflineUsers = async (
  recipientUserIds: string[],
  title: string,
  body: string,
  payloadData?: Record<string, string>,
  options?: Omit<SendPushOptions, 'payloadData'>
) => {
  return await sendPushNotification(recipientUserIds, title, body, {
    ...options,
    payloadData,
  });
};

export const getUserPreferences = async (userId: string) => {
  return await prisma.userNotificationPreference.findMany({
    where: { userId },
  });
};

export const upsertUserPreference = async (
  userId: string,
  input: UpdateNotificationPreferenceInput
) => {
  const { notificationType, inApp, push, email } = input;
  return await prisma.userNotificationPreference.upsert({
    where: {
      userId_notificationType: {
        userId,
        notificationType,
      },
    },
    update: {
      ...(inApp !== undefined && { inApp }),
      ...(push !== undefined && { push }),
      ...(email !== undefined && { email }),
    },
    create: {
      userId,
      notificationType,
      inApp: inApp ?? true,
      push: push ?? true,
      email: email ?? true,
    },
  });
};
