export interface NotificationDigestItem {
  title: string;
  body: string;
  createdAt: Date;
}

export const getNotificationDigestHtml = (
  recipientName: string,
  notifications: NotificationDigestItem[]
): string => {
  const itemsHtml = notifications
    .map(
      (n) => `
      <div style="padding: 12px 0; border-bottom: 1px solid #eee;">
        <div style="font-weight: 600; color: #1f2937; font-size: 14px;">${n.title}</div>
        <div style="color: #4b5563; font-size: 13px; margin-top: 4px;">${n.body}</div>
      </div>
    `
    )
    .join('');

  return `
    <div style="font-family: sans-serif; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; max-width: 500px; margin: 0 auto;">
      <h2 style="color: #111827; margin-bottom: 8px;">Quorum</h2>
      <p style="color: #374151; font-size: 15px;">Hi ${recipientName},</p>
      <p style="color: #6b7280; font-size: 14px; margin-bottom: 16px;">
        You have missed notifications while you were away:
      </p>
      <div style="background-color: #f9fafb; border-radius: 6px; padding: 0 16px; margin-bottom: 20px;">
        ${itemsHtml}
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        You received this email based on your Quorum notification preferences.
      </p>
    </div>
  `;
};
