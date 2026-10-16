import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import env from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

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

export const generateRawCompletion = async (
  prompt: string,
  systemInstruction?: string
): Promise<RawAiCompletionResult> => {
  const ai = getGenAIClient();
  const requestId = crypto.randomUUID();
  const model = String(env.GEMINI_MODEL || 'gemini-1.5-flash');

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: systemInstruction ? {
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        }
      } : undefined
    });

    const text = response.text || '';

    return {
      text,
      model,
      requestId,
      usage: response.usageMetadata || undefined
    };
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, `AI service provider failure: ${err.message || 'Unknown error'}`);
  }
};
