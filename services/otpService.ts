import redis from '../config/redis';
import { generateOTP } from '../utils/generateOTP';
import { hashToken } from '../utils/hashToken';
import { addEmailToQueue } from '../queues/emailQueue';

const OTP_TTL_SECONDS = parseInt(process.env.OTP_TTL_SECONDS || '600', 10);

export const storeAndSendOTP = async (
  email: string,
  redisKey: string,
  emailType: 'verification' | 'reset',
  payload?: any
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
    JSON.stringify({ codeHash, attempts: 0, createdAt: Date.now(), payload }),
    'EX',
    OTP_TTL_SECONDS
  );

  await addEmailToQueue(email, code, emailType);
  return true;
};

export const verifyOTPFromRedis = async (
  redisKey: string,
  otp: string
): Promise<{ success: boolean; message: string; payload?: any }> => {
  const inputHash = hashToken(otp);

  const luaScript = `
    local raw = redis.call('GET', KEYS[1])
    if not raw then
      return cjson.encode({ status = 'EXPIRED' })
    end

    local data = cjson.decode(raw)
    local storedHash = data.codeHash
    local attempts = data.attempts

    if attempts >= 5 then
      redis.call('DEL', KEYS[1])
      return cjson.encode({ status = 'TOO_MANY_ATTEMPTS' })
    end

    if ARGV[1] == storedHash then
      redis.call('DEL', KEYS[1])
      return cjson.encode({ status = 'SUCCESS', payload = data.payload })
    else
      data.attempts = attempts + 1
      redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
      return cjson.encode({ status = tostring(4 - attempts) })
    end
  `;

  const resultRaw = await redis.eval(luaScript, 1, redisKey, inputHash) as string;
  const result = JSON.parse(resultRaw);

  if (result.status === 'EXPIRED') {
    return { success: false, message: 'OTP expired or not found. Please request a new one.' };
  }
  if (result.status === 'TOO_MANY_ATTEMPTS') {
    return { success: false, message: 'Too many failed attempts. Please request a new OTP.' };
  }
  if (result.status === 'SUCCESS') {
    return { success: true, message: 'OTP verified successfully.', payload: result.payload };
  }
  
  return {
    success: false,
    message: `Incorrect OTP. You have ${result.status} attempts remaining.`,
  };
};
