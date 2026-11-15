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

  export const normalizeNotificationType = (raw: any): NotificationType | undefined => {
    if (!raw || typeof raw !== 'string') return undefined;
    const cleaned = raw.trim().toUpperCase().replace(/[-\s]/g, '_');

    if (Object.values(NotificationType).includes(cleaned as NotificationType)) {
      return cleaned as NotificationType;
    }

    switch (cleaned) {
      case 'DIRECT_MESSAGES':
      case 'DIRECT_MESSAGE':
      case 'DIRECTMESSAGES':
      case 'DIRECTMESSAGE':
      case 'CHAT':
      case 'CHATS':
      case 'CHAT_MESSAGE':
      case 'CHAT_MESSAGES':
      case 'DM':
      case 'DMS':
      case 'MESSAGES':
      case 'MESSAGE':
      case 'MESSAGE_REPLY':
        return NotificationType.DIRECT_MESSAGE;

      case 'COMMUNITY_COMMENTS':
      case 'COMMUNITY_COMMENT':
      case 'COMMUNITY_POST_COMMENTS':
      case 'COMMUNITY_POST_COMMENT':
      case 'COMMUNITY_POST':
      case 'COMMUNITY_POSTS':
      case 'COMMENTS':
      case 'COMMENT':
        return NotificationType.COMMUNITY_POST_COMMENT;

      case 'CALENDAR_REMINDERS':
      case 'CALENDAR_REMINDER':
      case 'CALENDAR':
      case 'CALENDARS':
      case 'EVENT_REMINDER':
      case 'EVENT_REMINDERS':
      case 'EVENT':
      case 'EVENTS':
        return NotificationType.EVENT_REMINDER;

      case 'ORGANIZATION_INVITES':
      case 'ORGANIZATION_INVITE':
      case 'ORG_INVITES':
      case 'ORG_INVITE':
      case 'ORGANIZATION':
      case 'ORG':
        return NotificationType.ORG_INVITE;

      case 'TEAM_INVITES':
      case 'TEAM_INVITE':
      case 'TEAMS':
      case 'TEAM':
        return NotificationType.TEAM_INVITE;

      case 'COMMUNITY_INVITES':
      case 'COMMUNITY_INVITE':
      case 'COMMUNITIES':
      case 'COMMUNITY':
        return NotificationType.COMMUNITY_INVITE;

      case 'MEETING_STARTED':
      case 'MEETING_STARTS':
      case 'MEETINGS':
      case 'MEETING':
        return NotificationType.MEETING_STARTED;

      case 'ORG_FEED_POST':
      case 'ORG_FEED_POSTS':
      case 'FEED_POST':
      case 'FEED_POSTS':
        return NotificationType.ORG_FEED_POST;

      case 'ORG_FEED_COMMENT':
      case 'ORG_FEED_COMMENTS':
      case 'FEED_COMMENT':
      case 'FEED_COMMENTS':
        return NotificationType.ORG_FEED_COMMENT;

      case 'SYSTEM':
      case 'SYSTEM_ALERT':
        return NotificationType.SYSTEM;

      default:
        return undefined;
    }
  };

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
    logger.info(`Registering FCM device token for user ${userId} on platform ${platform}`);
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
        targetUserIds = recipientUserIds.filter((id) => {
          const userPresence = presenceMap.get(id);
          if (userPresence?.status === 'DO_NOT_DISTURB') {
            return false;
          }
          return true;
        });
      } catch (presenceErr: any) {
        logger.warn('Failed to check presence for push targets, falling back to all targets', presenceErr);
        targetUserIds = recipientUserIds;
      }
    }

    if (targetUserIds.length === 0) {
      logger.debug('Push notification targets filtered out', { recipientUserIds });
      return;
    }

    // 1. Filter out users who turned off push notifications for this category
    const rawType = options?.payloadData?.type || options?.category;
    let resolvedType: NotificationType | undefined = normalizeNotificationType(rawType);

    // Fallback detection: if category is MESSAGE_REPLY, or channelId/conversationId is present, it's a chat message
    if (!resolvedType) {
      if (
        options?.conversationId ||
        options?.category === 'MESSAGE_REPLY' ||
        options?.channelId === 'quorum_chat_messages'
      ) {
        resolvedType = NotificationType.DIRECT_MESSAGE;
      }
    }

    if (resolvedType) {
      try {
        const disabledPrefs = await prisma.userNotificationPreference.findMany({
          where: {
            userId: { in: targetUserIds },
            notificationType: resolvedType,
            push: false,
          },
          select: { userId: true },
        });
        const disabledSet = new Set(disabledPrefs.map((p) => p.userId));
        targetUserIds = targetUserIds.filter((id) => !disabledSet.has(id));
        logger.info('[SendPushNotification] Preference filter check', {
          rawType,
          resolvedType,
          disabledCount: disabledPrefs.length,
          disabledUserIds: disabledPrefs.map((p) => p.userId),
          remainingTargetCount: targetUserIds.length,
        });
      } catch (prefErr: any) {
        logger.warn('Failed to query user notification preferences for push filter', prefErr);
      }
    }

    if (targetUserIds.length === 0) {
      logger.info('All push notification targets muted by user preferences', { rawType, resolvedType });
      return;
    }

    const devices = await prisma.deviceToken.findMany({
      where: { userId: { in: targetUserIds } },
      select: { token: true, userId: true, platform: true },
    });

    if (devices.length === 0) {
      logger.warn('No registered device tokens found for push notification recipients', { recipientUserIds: targetUserIds });
      return;
    }

    const tokens = devices.map((d) => d.token);
    logger.info('Dispatching push notification to devices', { recipientCount: targetUserIds.length, tokenCount: tokens.length, title });

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

    return result;
  };

  export const sendPushToOfflineUsers = async (
    recipientUserIds: string[],
    title: string,
    body: string,
    payloadData?: Record<string, string>,
    options?: Omit<SendPushOptions, 'payloadData'>
  ) => {
    return await sendPushNotification(recipientUserIds, title, body, {
      forcePush: true,
      ...options,
      payloadData,
    });
  };

  export const getUserPreferences = async (userId: string) => {
    const saved = await prisma.userNotificationPreference.findMany({
      where: { userId },
    });
    const savedMap = new Map(saved.map((p) => [p.notificationType, p]));

    const ALL_TYPES: NotificationType[] = [
      NotificationType.ORG_INVITE,
      NotificationType.TEAM_INVITE,
      NotificationType.COMMUNITY_INVITE,
      NotificationType.COMMUNITY_POST_COMMENT,
      NotificationType.MEETING_STARTED,
      NotificationType.DIRECT_MESSAGE,
      NotificationType.EVENT_REMINDER,
      NotificationType.ORG_FEED_POST,
      NotificationType.ORG_FEED_COMMENT,
    ];

    return ALL_TYPES.map((type) => {
      const existing = savedMap.get(type);
      if (existing) return existing;
      return {
        id: `default-${type}`,
        userId,
        notificationType: type,
        inApp: true,
        push: true,
        email: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
  };

  export const upsertUserPreference = async (
    userId: string,
    input: UpdateNotificationPreferenceInput
  ) => {
    const normalizedType = normalizeNotificationType(input.notificationType) || input.notificationType;
    const { inApp, push, email } = input;
    return await prisma.userNotificationPreference.upsert({
      where: {
        userId_notificationType: {
          userId,
          notificationType: normalizedType,
        },
      },
      update: {
        ...(inApp !== undefined && { inApp }),
        ...(push !== undefined && { push }),
        ...(email !== undefined && { email }),
      },
      create: {
        userId,
        notificationType: normalizedType,
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

    const resolvedNotificationType: NotificationType = normalizeNotificationType(type) || NotificationType.SYSTEM;

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
          forcePush: true,
        });
      } catch (pushErr: any) {
        logger.warn('Failed to dispatch push notification for in-app notification', pushErr);
      }
    }

    return notification;
  };
