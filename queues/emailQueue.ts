import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

import { sendOTPEmail } from '../services/emailService.js';

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

export const emailWorker = new Worker(
  'emailQueue',
  async (job: Job) => {
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

