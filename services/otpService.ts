import redis from '../config/redis';
import { generateOTP } from '../utils/generateOTP';
import { hashToken } from '../utils/hashToken';
import { addEmailToQueue } from '../queues/emailQueue';

const OTP_TTL_SECONDS = parseInt(process.env.OTP_TTL_SECONDS || '600', 10);

export const storeAndSendOTP = async (
  email: string,
  redisKey: string,
  emailType: 'verification' | 'reset'
): Promise<boolean> => {
  // Cooldown check (30 seconds)
  const existing = await redis.get(redisKey);
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed.createdAt && Date.now() - parsed.createdAt < 30 * 1000) {
        return false;
      }
    } catch (e) {}
  }

  const { code, codeHash } = generateOTP();

  await redis.set(
    redisKey,
    JSON.stringify({ codeHash, attempts: 0, createdAt: Date.now() }),
    'EX',
    OTP_TTL_SECONDS
  );

  await addEmailToQueue(email, code, emailType);
  return true;
};

export const verifyOTPFromRedis = async (
  redisKey: string,
  otp: string
): Promise<{ success: boolean; message: string }> => {
  const raw = await redis.get(redisKey);

  if (!raw) {
    return { success: false, message: 'OTP expired or not found. Please request a new one.' };
  }

  const { codeHash: storedHash, attempts } = JSON.parse(raw);

  if (attempts >= 5) {
    await redis.del(redisKey);
    return { success: false, message: 'Too many failed attempts. Please request a new OTP.' };
  }

  if (hashToken(otp) !== storedHash) {
    await redis.set(
      redisKey,
      JSON.stringify({ codeHash: storedHash, attempts: attempts + 1 }),
      'EX',
      OTP_TTL_SECONDS
    );
    return {
      success: false,
      message: `Incorrect OTP. You have ${4 - attempts} attempts remaining.`,
    };
  }

  await redis.del(redisKey);
  return { success: true, message: 'OTP verified successfully.' };
};
