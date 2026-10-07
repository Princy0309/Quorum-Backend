export interface PushPayload {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export const sendFCMNotification = async (payload: PushPayload) => {
  const { tokens, title, body, data } = payload;
  if (!tokens || tokens.length === 0) return;

  const firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!firebaseServiceAccount) {
    return;
  }

  try {
    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${firebaseServiceAccount}`
      },
      body: JSON.stringify({
        registration_ids: tokens,
        notification: { title, body },
        data
      })
    });
    await response.json();
  } catch (err) {}
};
