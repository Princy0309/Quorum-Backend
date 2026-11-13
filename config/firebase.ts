import fs from 'fs';
import path from 'path';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import logger from '../utils/logger.js';

let firebaseMessaging: Messaging | null = null;

const initFirebaseAdmin = () => {
  if (getApps().length > 0) {
    return getMessaging();
  }

  let serviceAccount: any = null;
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountRaw) {
    try {
      serviceAccount = JSON.parse(serviceAccountRaw);
    } catch {
      if (fs.existsSync(serviceAccountRaw)) {
        try {
          serviceAccount = JSON.parse(fs.readFileSync(serviceAccountRaw, 'utf-8'));
        } catch {}
      }
    }
  }

  if (!serviceAccount) {
    const candidatePaths = [
      path.resolve(process.cwd(), 'firebase-service-account.json'),
      path.resolve(process.cwd(), 'serviceAccountKey.json'),
      path.resolve(process.cwd(), 'config', 'firebase-service-account.json')
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          serviceAccount = JSON.parse(fs.readFileSync(p, 'utf-8'));
          break;
        } catch {}
      }
    }
  }

  if (!serviceAccount) {
    return null;
  }

  if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  try {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID || 'quorum-4d54b'
    });
    return getMessaging();
  } catch (err: any) {
    logger.error('Failed to initialize Firebase Admin SDK', { error: err.message });
    return null;
  }
};

firebaseMessaging = initFirebaseAdmin();

export interface PushPayload {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
  channelId?: string;
  conversationId?: string;
  tag?: string;
  category?: string;
  imageUrl?: string;
  priority?: 'high' | 'normal';
}

export interface SendFCMResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

const FCM_BATCH_SIZE = 500;

export const sendFCMNotification = async (payload: PushPayload): Promise<SendFCMResult> => {
  const { tokens, title, body, data } = payload;
  if (!tokens || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  if (!firebaseMessaging) {
    firebaseMessaging = initFirebaseAdmin();
  }

  if (!firebaseMessaging) {
    logger.warn('Firebase Messaging is not initialized; skipping push notification dispatch');
    return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
  }

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens: string[] = [];

  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    const batchTokens = tokens.slice(i, i + FCM_BATCH_SIZE);

    try {
      const formattedData: Record<string, string> = {};
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && value !== null) {
            formattedData[key] = typeof value === 'string' ? value : (typeof value === 'object' ? JSON.stringify(value) : String(value));
          }
        }
      }
      if (!formattedData.payload && (formattedData.conversationId || formattedData.messageId)) {
        formattedData.payload = JSON.stringify({
          conversationId: formattedData.conversationId || '',
          messageId: formattedData.messageId || ''
        });
      }

      const stableTag = payload.tag || payload.conversationId || formattedData.conversationId || formattedData.meetingCode || formattedData.meetingId || formattedData.notificationId || formattedData.id || 'quorum_notification';

      const messagePayload: any = {
        tokens: batchTokens,
        notification: {
          title,
          body,
          ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {})
        },
        data: formattedData,
        android: {
          priority: 'high',
          collapseKey: stableTag,
          notification: {
            title,
            body,
            channelId: 'quorum_chat_messages',
            sound: payload.sound || 'default',
            defaultSound: true,
            defaultVibrateTimings: true,
            priority: 'high',
            tag: stableTag,
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            ...(payload.badge !== undefined ? { notificationCount: payload.badge } : {}),
            ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {})
          }
        },
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'alert'
          },
          payload: {
            aps: {
              alert: {
                title,
                body
              },
              sound: payload.sound || 'default',
              badge: payload.badge !== undefined ? payload.badge : 1,
              'thread-id': stableTag,
              category: payload.category || (formattedData.type === 'CHAT_MESSAGE' ? 'MESSAGE_REPLY' : undefined),
              mutableContent: true
            }
          }
        },
        webpush: {
          notification: {
            title,
            body,
            icon: payload.imageUrl || '/icon-192.png',
            badge: '/badge-72.png',
            tag: stableTag,
            data: formattedData
          }
        }
      };

      const response = await firebaseMessaging.sendEachForMulticast(messagePayload);

      successCount += response.successCount;
      failureCount += response.failureCount;

      response.responses.forEach((res, idx) => {
        if (!res.success && res.error) {
          const code = res.error.code || '';
          const msg = res.error.message || '';
          const targetToken = batchTokens[idx] || '';
          const maskedToken = targetToken.length > 10 ? `***${targetToken.slice(-6)}` : '***';
          logger.error('FCM message delivery failed for token', {
            token: maskedToken,
            code,
            message: msg
          });

          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered' ||
            msg.includes('not registered') ||
            msg.includes('NotRegistered') ||
            msg.includes('invalid registration token')
          ) {
            invalidTokens.push(targetToken);
          }
        }
      });
    } catch (err: any) {
      logger.error('Unhandled error during FCM multicast batch dispatch', { error: err.message, batchSize: batchTokens.length });
      failureCount += batchTokens.length;
    }
  }

  return {
    successCount,
    failureCount,
    invalidTokens
  };
};



