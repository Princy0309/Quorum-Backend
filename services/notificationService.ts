import prisma from '../config/prisma.js';
import { sendFCMNotification } from '../config/firebase.js';
import { getMultipleUserPresences } from './presenceService.js';
import logger from '../utils/logger.js';

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
  if (!recipientUserIds || recipientUserIds.length === 0) return;

  const presenceMap = await getMultipleUserPresences(recipientUserIds);
  const offlineUserIds = recipientUserIds.filter((id) => !presenceMap.get(id)?.isOnline);

  if (offlineUserIds.length === 0) return;

  const devices = await prisma.deviceToken.findMany({
    where: { userId: { in: offlineUserIds } },
    select: { token: true }
  });

  const tokens = devices.map((d) => d.token);
  if (tokens.length === 0) return;

  const result = await sendFCMNotification({
    tokens,
    title,
    body,
    data: payloadData
  });

  if (result.invalidTokens && result.invalidTokens.length > 0) {
    logger.info('Pruning invalid FCM tokens from database', { count: result.invalidTokens.length });
    await prisma.deviceToken.deleteMany({
      where: { token: { in: result.invalidTokens } }
    });
  }
};

