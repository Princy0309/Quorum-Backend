import prisma from '../config/prisma.js';
import { sendFCMNotification } from '../config/firebase.js';
import { getUserPresence } from './presenceService.js';

export const registerDeviceToken = async (userId: string, token: string, platform: string = 'web') => {
  return await prisma.deviceToken.upsert({
    where: { token },
    update: { userId, platform, updatedAt: new Date() },
    create: { userId, token, platform }
  });
};

export const unregisterDeviceToken = async (userId: string, token: string) => {
  return await prisma.deviceToken.deleteMany({
    where: { userId, token }
  });
};

export const sendPushToOfflineUsers = async (
  recipientUserIds: string[],
  title: string,
  body: string,
  payloadData?: Record<string, string>
) => {
  const offlineUserIds: string[] = [];

  for (const userId of recipientUserIds) {
    const presence = await getUserPresence(userId);
    if (!presence.isOnline) {
      offlineUserIds.push(userId);
    }
  }

  if (offlineUserIds.length === 0) return;

  const devices = await prisma.deviceToken.findMany({
    where: { userId: { in: offlineUserIds } },
    select: { token: true }
  });

  const tokens = devices.map((d) => d.token);
  if (tokens.length === 0) return;

  await sendFCMNotification({
    tokens,
    title,
    body,
    data: payloadData
  });
};
