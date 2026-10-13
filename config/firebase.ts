import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import logger from '../utils/logger.js';

let firebaseMessaging: Messaging | null = null;

const initFirebaseAdmin = () => {
  if (getApps().length > 0) {
    return getMessaging();
  }

  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountRaw) {
    return null;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountRaw);
    initializeApp({
      credential: cert(serviceAccount)
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
      const response = await firebaseMessaging.sendEachForMulticast({
        tokens: batchTokens,
        notification: {
          title,
          body
        },
        data: data || {}
      });

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



