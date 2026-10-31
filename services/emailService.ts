import nodemailer from 'nodemailer';
import {
  getNotificationDigestHtml,
  getOrgInviteEmailHtml,
  NotificationDigestItem,
  getMeetingInviteEmailHtml,
  getScopedMeetingInviteEmailHtml,
  getOTPEmailHtml,
} from '../utils/emailTemplate.js';

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendOTPEmail = async (to: string, otp: string, purpose: 'verification' | 'reset' = 'verification'): Promise<any> => {
  let subject = 'Verify Your Email - Quorum';
  let message = 'Your email verification code is : ';

  if (purpose === 'reset') {
    subject = 'Password reset code - Quorum';
    message = 'Your password reset code is: ';
  }

  const html = getOTPEmailHtml(message, otp, purpose);

  const mailOptions = {
    from: `"Quorum" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  };

  return await transporter.sendMail(mailOptions);
};


export const sendNotificationDigestEmail = async (
  to: string,
  recipientName: string,
  notifications: NotificationDigestItem[]
): Promise<any> => {
  const html = getNotificationDigestHtml(recipientName, notifications);
  const subject = `You have ${notifications.length} unread notification${notifications.length > 1 ? 's' : ''} on Quorum`;

  return await transporter.sendMail({
    from: `"Quorum" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
};

export const sendOrgInviteEmail = async (
  to: string,
  inviterName: string,
  orgName: string,
  role: string,
  inviteLink: string,
  expiresInDays: number = 7,
  teamName?: string,
  teamRole?: string
): Promise<any> => {
  const html = getOrgInviteEmailHtml(
    inviterName,
    orgName,
    role,
    inviteLink,
    expiresInDays,
    teamName,
    teamRole
  );

  let subject = `${inviterName} invited you to join ${orgName} on Quorum`;
  if (teamName) {
    if (teamRole?.toUpperCase() === 'LEAD') {
      subject = `${inviterName} invited you to lead ${teamName} at ${orgName} on Quorum`;
    } else {
      subject = `${inviterName} invited you to join ${teamName} at ${orgName} on Quorum`;
    }
  }

  return await transporter.sendMail({
    from: `"Quorum" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
};


export const sendMeetingInviteEmail = async (
  to: string,
  inviterName: string,
  meetingTitle: string,
  formattedDate: string,
  meetingLink?: string
): Promise<any> => {
  const html = getMeetingInviteEmailHtml(inviterName, meetingTitle, formattedDate, meetingLink);
  const subject = `Invitation: ${meetingTitle} - Quorum`;

  return await transporter.sendMail({
    from: `"Quorum Calendar" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
};

export const sendScopedMeetingInviteEmail = async (
  to: string,
  inviterName: string,
  meetingTitle: string,
  scopeName: string,
  scopeType: string,
  formattedDate: string,
  meetingLink?: string
): Promise<any> => {
  const html = getScopedMeetingInviteEmailHtml(
    inviterName,
    meetingTitle,
    scopeName,
    scopeType,
    formattedDate,
    meetingLink
  );
  const subject = `Meeting Invitation: ${meetingTitle} [${scopeName}]`;

  return await transporter.sendMail({
    from: `"Quorum Meetings" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
};



export default { transporter, sendOTPEmail, sendNotificationDigestEmail, sendOrgInviteEmail };
