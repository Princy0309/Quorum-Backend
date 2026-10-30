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

export const getOrgInviteEmailHtml = (
  inviterName: string,
  orgName: string,
  role: string,
  inviteLink: string,
  expiresInDays: number = 7,
  teamName?: string,
  teamRole?: string
): string => {
  let invitationText = `<strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> as a <strong>${role}</strong> on Quorum.`;

  if (teamName) {
    if (teamRole?.toUpperCase() === 'LEAD') {
      invitationText = `<strong>${inviterName}</strong> has invited you to be the <strong>Team Lead</strong> of <strong>${teamName}</strong> at <strong>${orgName}</strong> on Quorum.`;
    } else {
      invitationText = `<strong>${inviterName}</strong> has invited you to join <strong>${teamName}</strong> at <strong>${orgName}</strong> on Quorum.`;
    }
  }

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; max-width: 500px; margin: 0 auto; color: #1f2937;">
      <h2 style="color: #4F46E5; margin-bottom: 8px;">Quorum</h2>
      <p style="font-size: 15px; margin-top: 16px;">Hello,</p>
      <p style="font-size: 15px; line-height: 1.5;">
        ${invitationText}
      </p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${inviteLink}" style="background-color: #4F46E5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">
          Accept Invitation
        </a>
      </div>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.4;">
        Or copy and paste this URL into your browser:<br/>
        <a href="${inviteLink}" style="color: #4F46E5; word-break: break-all;">${inviteLink}</a>
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">
        This invitation will expire in ${expiresInDays} days. If you were not expecting this invitation, you can safely ignore this email.
      </p>
    </div>
  `;
};


export const getMeetingInviteEmailHtml = (
  inviterName: string,
  meetingTitle: string,
  formattedDate: string,
  meetingLink?: string
): string => {
  const joinButton = meetingLink
    ? `
      <div style="text-align: center; margin: 28px 0;">
        <a href="${meetingLink}" style="background-color: #4F46E5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">
          Join Meeting
        </a>
      </div>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.4;">
        Or copy and paste this link into your browser:<br/>
        <a href="${meetingLink}" style="color: #4F46E5; word-break: break-all;">${meetingLink}</a>
      </p>
    `
    : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; max-width: 500px; margin: 0 auto; color: #1f2937;">
      <h2 style="color: #4F46E5; margin-bottom: 8px;">Quorum Calendar</h2>
      <p style="font-size: 15px; margin-top: 16px;">Hello,</p>
      <p style="font-size: 15px; line-height: 1.5;">
        <strong>${inviterName}</strong> has invited you to a scheduled meeting on Quorum:
      </p>
      <div style="background-color: #f9fafb; border-left: 4px solid #4F46E5; padding: 12px 16px; margin: 20px 0; border-radius: 0 6px 6px 0;">
        <div style="font-weight: 700; font-size: 16px; color: #111827;">${meetingTitle}</div>
        <div style="color: #4b5563; font-size: 14px; margin-top: 4px;">📅 ${formattedDate}</div>
      </div>
      ${joinButton}
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        This invitation was automatically generated by Quorum Calendar.
      </p>
    </div>
  `;
};

export const getScopedMeetingInviteEmailHtml = (
  inviterName: string,
  meetingTitle: string,
  scopeName: string,
  scopeType: string,
  formattedDate: string,
  meetingLink?: string
): string => {
  const joinButton = meetingLink
    ? `
      <div style="text-align: center; margin: 28px 0;">
        <a href="${meetingLink}" style="background-color: #4F46E5; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);">
          Join Video Meeting
        </a>
      </div>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.4; text-align: center;">
        Or paste this link into your browser:<br/>
        <a href="${meetingLink}" style="color: #4F46E5; word-break: break-all;">${meetingLink}</a>
      </p>
    `
    : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 28px; border: 1px solid #e5e7eb; border-radius: 12px; max-width: 520px; margin: 0 auto; color: #1f2937; background-color: #ffffff;">
      <div style="margin-bottom: 20px;">
        <h2 style="color: #4F46E5; margin: 0; font-size: 20px; font-weight: 700;">Quorum Meetings</h2>
      </div>
      <p style="font-size: 15px; line-height: 1.6; color: #374151;">
        Hello,
      </p>
      <p style="font-size: 15px; line-height: 1.6; color: #374151;">
        <strong>${inviterName}</strong> has scheduled a video meeting for <strong>${scopeName}</strong>:
      </p>
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #4F46E5; padding: 16px 20px; margin: 22px 0; border-radius: 6px;">
        <div style="font-weight: 700; font-size: 17px; color: #0f172a; margin-bottom: 8px;">${meetingTitle}</div>
        <div style="color: #475569; font-size: 14px; margin-bottom: 6px;">📅 <strong>When:</strong> ${formattedDate}</div>
        <div style="color: #475569; font-size: 14px; margin-bottom: 6px;">👥 <strong>Scope:</strong> ${scopeType} (${scopeName})</div>
        <div style="color: #475569; font-size: 14px;">👤 <strong>Host:</strong> ${inviterName}</div>
      </div>
      ${joinButton}
      <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
        This invitation was automatically generated by Quorum for ${scopeName} members.
      </p>
    </div>
  `;
};


