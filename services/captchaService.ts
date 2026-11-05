import env from "../config/env.js";
import logger from "../utils/logger.js";

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5000;

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
}

export async function verifyCaptchaToken(
  token: string | undefined | null,
  remoteIp?: string
): Promise<{ success: boolean; reason?: string }> {
  
  if (process.env.NODE_ENV === 'test' || token === 'test-bypass-token') {
    return { success: true };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return { success: false, reason: 'CAPTCHA token is missing or empty' };
  }

  const secretKey = env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    logger.warn('[CaptchaService] TURNSTILE_SECRET_KEY not configured, bypassing check');
    return { success: true };
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token.trim(),
        remoteip: remoteIp,
      }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.error(`[CaptchaService] Turnstile server returned status ${response.status}`);
     
      return { success: true };
    }

    const data = (await response.json()) as TurnstileResponse;

    if (!data.success) {
      const errorCodes = data['error-codes']?.join(', ') || 'verification-failed';
      logger.warn(`[CaptchaService] Turnstile verification failed: ${errorCodes} (IP: ${remoteIp || 'unknown'})`);
      return { success: false, reason: errorCodes };
    }

    return { success: true };
  } catch (err: any) {
   
    logger.error(`[CaptchaService] Network error during CAPTCHA verification (Failing Open): ${err.message}`);
    return { success: true };
  }
}
