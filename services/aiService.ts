import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import env from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';

let genAIClient: GoogleGenAI | null = null;

const getGenAIClient = (): GoogleGenAI => {
  const apiKey = String(env.GEMINI_API_KEY || '');
  if (!apiKey) {
    throw new ApiError(503, 'AI service is not configured. Please set GEMINI_API_KEY in backend environment.');
  }
  if (!genAIClient) {
    genAIClient = new GoogleGenAI({ apiKey });
  }
  return genAIClient;
};

export interface RawAiCompletionResult {
  text: string;
  model: string;
  requestId: string;
  usage?: any;
}

export const sanitizeAiInput = (input: string): string => {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_TOKEN]')
    .replace(/(AIza[0-9A-Za-z-_]{35}|AKIA[0-9A-Z]{16})/g, '[REDACTED_KEY]')
    .replace(/\$2[abxy]?\$\d{1,2}\$[A-Za-z0-9./]{53}/g, '[REDACTED_HASH]');
};

export const generateRawCompletion = async (
  prompt: string,
  systemInstruction?: string
): Promise<RawAiCompletionResult> => {
  const ai = getGenAIClient();
  const requestId = crypto.randomUUID();
  const model = String(env.GEMINI_MODEL || 'gemini-1.5-flash');

  const sanitizedPrompt = sanitizeAiInput(prompt).slice(0, 20000);
  const sanitizedInstruction = systemInstruction ? sanitizeAiInput(systemInstruction) : undefined;

  let timer: any = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ApiError(504, 'AI model provider request timed out. Please try again.'));
      }, 25000);
    });

    const executionPromise = ai.models.generateContent({
      model,
      contents: sanitizedPrompt,
      config: sanitizedInstruction ? {
        systemInstruction: {
          parts: [{ text: sanitizedInstruction }]
        }
      } : undefined
    });

    const response = await Promise.race([executionPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    const text = response.text || '';

    return {
      text,
      model,
      requestId,
      usage: response.usageMetadata || undefined
    };
  } catch (err: any) {
    if (timer) clearTimeout(timer);
    if (err instanceof ApiError) throw err;

    const msg = String(err?.message || '');
    logger.error('AI provider execution error', {
      requestId,
      model,
      error: msg
    });

    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota')) {
      throw new ApiError(429, 'AI provider quota limit reached. Please wait a moment before retrying.');
    }

    throw new ApiError(502, 'AI service provider failed to process the request. Please try again later.');
  }
};
