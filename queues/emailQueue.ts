import { Queue, Worker, Job } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { OrgInviteEmailJobData } from '../types/organization.js';

import { sendOTPEmail, sendOrgInviteEmail, sendMeetingInviteEmail } from '../services/emailService.js';

export const queueRedisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue('emailQueue', {
  connection: queueRedisConnection,
});

export const addEmailToQueue = async (
  email: string,
  otp: string,
  purpose: 'verification' | 'reset'
) => {
  return await emailQueue.add(
    'sendOTPEmail',
    { email, otp, purpose },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
};


export const addOrgInviteEmailToQueue = async (data: OrgInviteEmailJobData) => {
  return await emailQueue.add(
    'sendOrgInviteEmail',
    data,
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
};

export const addMeetingInviteEmailToQueue = async (data: {
  email: string;
  inviterName: string;
  meetingTitle: string;
  formattedDate: string;
  meetingLink?: string;
}) => {
  return await emailQueue.add(
    'sendMeetingInviteEmail',
    data,
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: 50,
    }
  );
};



export const emailWorker = new Worker(
  'emailQueue',
  async (job: Job) => {
    if (job.name === 'sendOrgInviteEmail') {
      const { email, inviterName, orgName, role, inviteLink, expiresInDays, teamName, teamRole } = job.data;
      console.log(`[EmailWorker] Processing job #${job.id}: Sending org invite email to ${email}`);

      await sendOrgInviteEmail(email, inviterName, orgName, role, inviteLink, expiresInDays, teamName, teamRole);

      console.log(`[EmailWorker] Job #${job.id} completed: Org invite sent to ${email}`);
      return;
    }

    if (job.name === 'sendMeetingInviteEmail') {
      const { email, inviterName, meetingTitle, formattedDate, meetingLink } = job.data;
      console.log(`[EmailWorker] Processing job #${job.id}: Sending meeting invite to ${email}`);
      await sendMeetingInviteEmail(email, inviterName, meetingTitle, formattedDate, meetingLink);
      console.log(`[EmailWorker] Job #${job.id} completed: Meeting invite sent to ${email}`);
      return;
    }


    const { email, otp, purpose } = job.data;
    console.log(`[EmailWorker] Processing job #${job.id}: Sending ${purpose} OTP to ${email}`);

    await sendOTPEmail(email, otp, purpose);

    console.log(`[EmailWorker] Job #${job.id} completed successfully for ${email}`);
  },
  {
    connection: queueRedisConnection,
    concurrency: 5,
  }
);


emailWorker.on('completed', (job) => {
  console.log(`[EmailWorker] Email job ${job.id} has finished sending.`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`[EmailWorker] Email job ${job?.id} failed with error:`, err.message);
});

