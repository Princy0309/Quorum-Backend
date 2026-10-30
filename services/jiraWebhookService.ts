import crypto from 'crypto';
import prisma from '../config/prisma.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader?: string): boolean {
  if (!signatureHeader) {
    return false;
  }

  const secret = env.JIRA_STATE_SECRET;
  if (!secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const cleanProvided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;

  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  const providedBuf = Buffer.from(cleanProvided, 'hex');

  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export async function processJiraWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  payload: any
) {
  const isSignatureValid = verifyWebhookSignature(rawBody, signatureHeader);

  const webhookEvent = payload?.webhookEvent || 'unknown';
  const issue = payload?.issue;
  const timestamp = payload?.timestamp || Date.now();

  const eventId = issue?.id
    ? `${webhookEvent}_${issue.id}_${timestamp}`
    : `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const existingEvent = await prisma.jiraWebhookEvent.findUnique({
    where: { eventId },
  });

  if (existingEvent) {
    logger.info(`Ignoring duplicate Jira webhook event: ${eventId}`);
    return { duplicate: true };
  }

  const loggedEvent = await prisma.jiraWebhookEvent.create({
    data: {
      eventId,
      eventType: webhookEvent,
      payload: payload || {},
      signature: signatureHeader || null,
      signatureValid: isSignatureValid,
      processed: false,
    },
  });

  if (!isSignatureValid) {
    logger.warn(`Rejected Jira webhook event ${eventId} due to invalid signature`);
    await prisma.jiraWebhookEvent.update({
      where: { id: loggedEvent.id },
      data: { error: 'Invalid HMAC signature' },
    });
    return { error: 'Invalid HMAC signature' };
  }

  if (issue && issue.key) {
    const cleanKey = issue.key.toUpperCase();
    const newStatus = issue.fields?.status?.name;
    const newSummary = issue.fields?.summary;

    const existingTicket = await prisma.jiraTicketLink.findFirst({
      where: { jiraKey: cleanKey },
    });

    if (existingTicket) {
      await prisma.jiraTicketLink.update({
        where: { id: existingTicket.id },
        data: {
          ...(newStatus ? { jiraStatus: newStatus } : {}),
          ...(newSummary ? { jiraSummary: newSummary } : {}),
          lastSyncedAt: new Date(),
        },
      });

      await prisma.jiraWebhookEvent.update({
        where: { id: loggedEvent.id },
        data: {
          processed: true,
          processedAt: new Date(),
        },
      });

      logger.info(`Synced ticket ${cleanKey} from Jira webhook: Status="${newStatus}"`);
    }
  }

  return { success: true, eventId };
}
