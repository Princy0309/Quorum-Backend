import type { NotificationType } from '@prisma/client';

export interface CreateNotificationInput {
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface GetNotificationsOptions {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}

export interface NotificationActor {
  id: string;
  name: string;
  avatar: string | null;
}

export interface NotificationItem {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data: any;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  actor?: NotificationActor | null;
}

export interface PaginatedNotificationsResult {
  notifications: NotificationItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  unreadCount: number;
}

export interface UpdateNotificationPreferenceInput {
  notificationType: NotificationType;
  inApp?: boolean;
  push?: boolean;
  email?: boolean;
}
