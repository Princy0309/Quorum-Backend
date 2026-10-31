export interface NotificationDigestItem {
  title: string;
  body: string;
  createdAt: Date;
}

export const wrapInDarkMasterShell = (contentHtml: string, footerNote: string): string => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quorum</title>
</head>
<body style="margin: 0; padding: 0; background-color: #080B10; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #080B10; padding: 48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 540px; background-color: #0F1523; border-radius: 20px; border: 1px solid rgba(139, 92, 246, 0.35); box-shadow: 0 0 35px -5px rgba(139, 92, 246, 0.2), 0 20px 40px -15px rgba(0, 0, 0, 0.8); overflow: hidden;">
          <tr>
            <td align="center" style="padding: 40px 40px 18px 40px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                <tr>
                  <td align="center">
                    <svg width="68" height="68" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; margin: 0 auto;">
                      <defs>
                        <linearGradient id="quorumGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                          <stop offset="0%" stop-color="#38BDF8" />
                          <stop offset="50%" stop-color="#6366F1" />
                          <stop offset="100%" stop-color="#A855F7" />
                        </linearGradient>
                      </defs>
                      <circle cx="50" cy="22" r="7" fill="url(#quorumGrad)" />
                      <path d="M50 33 C40 33 32 38 28 46 C25 52 26 60 30 65 C33 69 38 70 37 66 C35 60 35 54 39 48 C42 44 47 41 54 41 C60 41 66 44 70 49 C73 53 76 51 74 47 C70 39 61 33 50 33 Z" fill="url(#quorumGrad)" />
                      <circle cx="26" cy="66" r="7" fill="url(#quorumGrad)" />
                      <path d="M35 69 C31 77 32 86 39 92 C45 97 54 97 60 94 C65 92 65 87 61 89 C55 92 49 91 42 87 C37 84 34 79 35 72 C36 66 41 61 46 57 C50 54 48 51 44 52 C37 56 31 63 35 69 Z" fill="url(#quorumGrad)" />
                      <circle cx="74" cy="66" r="7" fill="url(#quorumGrad)" />
                      <path d="M65 89 C73 89 82 85 87 78 C92 71 91 62 87 56 C84 51 80 53 82 57 C84 63 83 70 79 75 C75 79 69 81 63 78 C57 75 54 69 52 63 C50 59 47 61 49 65 C53 73 58 79 65 89 Z" fill="url(#quorumGrad)" />
                    </svg>
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 20px; font-weight: 800; letter-spacing: 6px; color: #D8B4FE; text-transform: uppercase; margin-top: 14px; text-shadow: 0 0 18px rgba(168, 85, 247, 0.45); padding-left: 6px;">
                      QUORUM
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 40px 28px 40px; color: #F1F5F9; font-size: 15px; line-height: 1.6; text-align: center;">
              ${contentHtml}
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 0;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 36px 40px; text-align: center;">
              <div style="margin-bottom: 8px;">
                <span style="display: inline-block; font-size: 14px; color: #64748B;">&#128274;</span>
              </div>
              <p style="color: #64748B; font-size: 12px; line-height: 1.5; margin: 0 0 6px 0;">
                ${footerNote}
              </p>
              <p style="color: #475569; font-size: 11px; margin: 0;">
                &copy; ${new Date().getFullYear()} Quorum Platform &bull; All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

export const getOTPEmailHtml = (message: string, otp: string, purpose: 'verification' | 'reset'): string => {
  const title = purpose === 'reset' ? 'Password Reset Code' : 'Verification Code';
  const subtext = purpose === 'reset'
    ? 'Use the secure code below to reset your password on Quorum.'
    : 'Use the code below to complete your action on Quorum.';

  const content = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 0 0 10px 0; letter-spacing: -0.4px;">
      ${title}
    </h1>
    <p style="color: #94A3B8; font-size: 14px; margin: 0 0 24px 0; line-height: 1.5;">
      ${subtext}
    </p>
    <div style="background-color: rgba(22, 31, 48, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 22px 20px; margin: 0 auto 24px auto; max-width: 320px; box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);">
      <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 32px; font-weight: 700; letter-spacing: 10px; color: #FFFFFF; text-shadow: 0 0 14px rgba(167, 139, 250, 0.5);">
        ${otp}
      </div>
    </div>
    <p style="color: #64748B; font-size: 12px; margin: 0; line-height: 1.5;">
      This code will expire in <strong>10 minutes</strong>. If you did not request this, please ignore this email or contact support.
    </p>
  `;

  return wrapInDarkMasterShell(content, 'This is a secure authentication notification from Quorum.');
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
  let headline = `Invitation to join '${orgName}' on Quorum`;
  let roleDisplay = role;
  let teamDisplay = teamName || '';

  if (teamName) {
    if (teamRole?.toUpperCase() === 'LEAD') {
      headline = `Invitation to lead '${teamName}' at ${orgName}`;
      roleDisplay = 'Team Lead';
    } else {
      headline = `Invitation to join '${teamName}' at ${orgName}`;
      roleDisplay = teamRole || role;
    }
  }

  const content = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 0 0 10px 0; letter-spacing: -0.4px;">
      ${headline}
    </h1>
    <p style="color: #94A3B8; font-size: 14px; margin: 0 0 24px 0; line-height: 1.5;">
      <strong style="color: #FFFFFF;">${inviterName}</strong> has invited you to collaborate on Quorum.
    </p>
    <div style="background-color: rgba(22, 31, 48, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 18px 24px; margin: 0 auto 28px auto; text-align: left;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="color: #64748B; font-size: 13px; padding: 5px 0;">Invited By:</td>
          <td align="right" style="color: #F8FAFC; font-size: 13px; font-weight: 600; padding: 5px 0;">${inviterName}</td>
        </tr>
        <tr>
          <td style="color: #64748B; font-size: 13px; padding: 5px 0;">Organization:</td>
          <td align="right" style="color: #F8FAFC; font-size: 13px; font-weight: 600; padding: 5px 0;">${orgName}</td>
        </tr>
        ${
          teamDisplay
            ? `<tr>
                <td style="color: #64748B; font-size: 13px; padding: 5px 0;">Team:</td>
                <td align="right" style="color: #F8FAFC; font-size: 13px; font-weight: 600; padding: 5px 0;">${teamDisplay}</td>
              </tr>`
            : ''
        }
        <tr>
          <td style="color: #64748B; font-size: 13px; padding: 5px 0;">Role:</td>
          <td align="right" style="color: #A5B4FC; font-size: 13px; font-weight: 600; padding: 5px 0;">${roleDisplay}</td>
        </tr>
      </table>
    </div>
    <div style="margin: 28px 0 20px 0;">
      <a href="${inviteLink}" style="background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%); color: #FFFFFF; padding: 14px 38px; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 20px rgba(139, 92, 246, 0.45); letter-spacing: -0.2px;">
        Accept Invitation
      </a>
    </div>
    <p style="font-size: 12px; color: #64748B; line-height: 1.5; margin: 0;">
      Or copy and paste this URL into your browser:<br/>
      <a href="${inviteLink}" style="color: #A5B4FC; word-break: break-all; text-decoration: none;">${inviteLink}</a>
    </p>
  `;

  const footer = `This invitation will expire in ${expiresInDays} days. If you did not expect this invitation, you can safely ignore this email.`;

  return wrapInDarkMasterShell(content, footer);
};

export const getMeetingInviteEmailHtml = (
  inviterName: string,
  meetingTitle: string,
  formattedDate: string,
  meetingLink?: string
): string => {
  const joinButton = meetingLink
    ? `
      <div style="margin: 28px 0 20px 0;">
        <a href="${meetingLink}" style="background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%); color: #FFFFFF; padding: 14px 38px; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 20px rgba(139, 92, 246, 0.45);">
          Join Meeting
        </a>
      </div>
      <p style="font-size: 12px; color: #64748B; line-height: 1.5; margin: 0;">
        Meeting link: <a href="${meetingLink}" style="color: #A5B4FC; word-break: break-all; text-decoration: none;">${meetingLink}</a>
      </p>
    `
    : '';

  const content = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 0 0 10px 0; letter-spacing: -0.4px;">
      Meeting Scheduled
    </h1>
    <p style="color: #94A3B8; font-size: 14px; margin: 0 0 24px 0; line-height: 1.5;">
      <strong style="color: #FFFFFF;">${inviterName}</strong> has invited you to a meeting on Quorum.
    </p>
    <div style="background-color: rgba(22, 31, 48, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 20px 24px; margin: 0 auto 24px auto; text-align: left;">
      <div style="color: #FFFFFF; font-size: 16px; font-weight: 700; margin-bottom: 10px;">
        ${meetingTitle}
      </div>
      <div style="color: #94A3B8; font-size: 14px; line-height: 1.6;">
        &#128197; <strong style="color: #E2E8F0;">When:</strong> ${formattedDate}<br/>
        &#128100; <strong style="color: #E2E8F0;">Host:</strong> ${inviterName}
      </div>
    </div>
    ${joinButton}
  `;

  return wrapInDarkMasterShell(content, 'This invitation was automatically generated by Quorum Calendar.');
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
      <div style="margin: 28px 0 20px 0;">
        <a href="${meetingLink}" style="background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%); color: #FFFFFF; padding: 14px 38px; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 20px rgba(139, 92, 246, 0.45);">
          Join Video Meeting
        </a>
      </div>
      <p style="font-size: 12px; color: #64748B; line-height: 1.5; margin: 0;">
        Meeting link: <a href="${meetingLink}" style="color: #A5B4FC; word-break: break-all; text-decoration: none;">${meetingLink}</a>
      </p>
    `
    : '';

  const content = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 0 0 10px 0; letter-spacing: -0.4px;">
      Video Meeting Invitation
    </h1>
    <p style="color: #94A3B8; font-size: 14px; margin: 0 0 24px 0; line-height: 1.5;">
      <strong style="color: #FFFFFF;">${inviterName}</strong> scheduled a meeting for <strong style="color: #FFFFFF;">${scopeName}</strong>.
    </p>
    <div style="background-color: rgba(22, 31, 48, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 20px 24px; margin: 0 auto 24px auto; text-align: left;">
      <div style="color: #FFFFFF; font-size: 16px; font-weight: 700; margin-bottom: 12px;">
        ${meetingTitle}
      </div>
      <div style="color: #94A3B8; font-size: 14px; line-height: 1.7;">
        &#128197; <strong style="color: #E2E8F0;">When:</strong> ${formattedDate}<br/>
        &#128101; <strong style="color: #E2E8F0;">Scope:</strong> ${scopeType} (${scopeName})<br/>
        &#128100; <strong style="color: #E2E8F0;">Host:</strong> ${inviterName}
      </div>
    </div>
    ${joinButton}
  `;

  return wrapInDarkMasterShell(content, `This invitation was automatically generated by Quorum for ${scopeName} members.`);
};

export const getNotificationDigestHtml = (
  recipientName: string,
  notifications: NotificationDigestItem[]
): string => {
  const itemsHtml = notifications
    .map(
      (n) => `
      <div style="padding: 14px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); text-align: left;">
        <div style="font-weight: 600; color: #F8FAFC; font-size: 14px;">${n.title}</div>
        <div style="color: #94A3B8; font-size: 13px; margin-top: 4px;">${n.body}</div>
      </div>
    `
    )
    .join('');

  const content = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 0 0 10px 0; letter-spacing: -0.4px;">
      Activity Digest
    </h1>
    <p style="color: #94A3B8; font-size: 14px; margin: 0 0 24px 0;">
      Hi ${recipientName}, here are the notifications you missed while you were away:
    </p>
    <div style="background-color: rgba(22, 31, 48, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 6px 20px; margin: 0 auto 24px auto;">
      ${itemsHtml}
    </div>
  `;

  return wrapInDarkMasterShell(content, 'You received this email based on your Quorum notification preferences.');
};
