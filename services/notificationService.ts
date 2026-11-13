import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { NotificationType } from '@prisma/client';
import { sendFCMNotification, PushPayload } from '../config/firebase.js';
import { getMultipleUserPresences } from './presenceService.js';
import { getIO } from '../sockets/socketServer.js';
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

export const unregisterDeviceToken = async (userId: string | undefined, token: string) => {
  return await prisma.deviceToken.deleteMany({
    where: {
      token,
      ...(userId ? { userId } : {})
    },
  });
};

export interface SendPushOptions {
  payloadData?: Record<string, string>;
  conversationId?: string;
  tag?: string;
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
    try {
      const presenceMap = await getMultipleUserPresences(recipientUserIds);
      const appStateKeys = recipientUserIds.map((id) => `user_app_state:${id}`);
      const appStates = await redis.mget(...appStateKeys);

      targetUserIds = recipientUserIds.filter((id, idx) => {
        const userPresence = presenceMap.get(id);
       
        if (userPresence?.status === 'DO_NOT_DISTURB') {
          return false;
        }
        const isOnline = !!userPresence?.isOnline;
        const appState = appStates[idx];
        return !isOnline || appState === 'background' || !appState;
      });
    } catch (presenceErr: any) {
      logger.warn('Failed to check presence for push targets, falling back to all targets', presenceErr);
      targetUserIds = recipientUserIds;
    }
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
    tag: options?.tag,
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

export interface InAppNotificationInput {
  recipientId: string;
  type: NotificationType | string;
  title: string;
  body: string;
  actorId?: string | null;
  data?: Record<string, any>;
  skipPush?: boolean;
}

export const createAndDispatchNotification = async (input: InAppNotificationInput) => {
  const { recipientId, actorId, type, title, body, data, skipPush } = input;

  if (actorId && actorId === recipientId) {
    return null;
  }

  const resolvedNotificationType: NotificationType = Object.values(NotificationType).includes(type as NotificationType)
    ? (type as NotificationType)
    : (type === 'CHAT_MESSAGE' ? NotificationType.DIRECT_MESSAGE : NotificationType.SYSTEM);

  const preference = await prisma.userNotificationPreference.findUnique({
    where: {
      userId_notificationType: {
        userId: recipientId,
        notificationType: resolvedNotificationType,
      },
    },
  });

  const allowInApp = preference ? preference.inApp : true;
  const allowPush = preference ? preference.push : true;

  let notification = null;
  if (allowInApp) {
    try {
      notification = await prisma.notification.create({
        data: {
          recipientId,
          actorId: actorId || null,
          type: resolvedNotificationType,
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

      try {
        const io = getIO();
        io.to(`user:${recipientId}`).emit('notification:new', notification);
      } catch (socketErr: any) {
        logger.debug('Socket broadcast skipped in createAndDispatchNotification', socketErr);
      }
    } catch (dbErr: any) {
      logger.error('Failed to create in-app notification', dbErr);
    }
  }

  if (allowPush && !skipPush) {
    try {
      const stringifiedData: Record<string, string> = { type };
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && value !== null) {
            stringifiedData[key] = typeof value === 'string' ? value : (typeof value === 'object' ? JSON.stringify(value) : String(value));
          }
        }
      }

      const conversationId = stringifiedData.conversationId || stringifiedData.communityId;
      const tag = conversationId || stringifiedData.meetingCode || stringifiedData.meetingId || stringifiedData.eventId || (notification ? notification.id : undefined);

      await sendPushNotification([recipientId], title, body, {
        payloadData: stringifiedData,
        conversationId,
        tag,
        channelId: 'quorum_chat_messages',
        category: type.includes('CHAT') ? 'MESSAGE_REPLY' : undefined,
        sound: 'default',
      });
    } catch (pushErr: any) {
      logger.warn('Failed to dispatch push notification for in-app notification', pushErr);
    }
  }

  return notification;
};
