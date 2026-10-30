import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { processJiraWebhook } from '../services/jiraWebhookService.js';

export const handleJiraWebhookController = asyncHandler(async (req: Request, res: Response) => {
  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const signature = (
    req.headers['x-hub-signature'] ||
    req.headers['x-atlassian-webhook-signature'] ||
    req.headers['x-hub-signature-256']
  ) as string | undefined;

  const result = await processJiraWebhook(rawBody, signature, req.body);
  if (result.error) {
    return res.status(401).json({ received: false, error: result.error });
  }
  return res.status(200).json({ received: true, ...result });
});
