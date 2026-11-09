import crypto from 'crypto';
import prisma from '../config/prisma.js';
import logger from '../utils/logger.js';
import { decryptJiraToken } from '../utils/jiraCrypto.js';

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader?: string,
  secret?: string
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  try {
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
  } catch {
    return false;
  }
}

export async function processJiraWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  payload: any
) {
  const webhookEvent = payload?.webhookEvent || 'unknown';
  const issue = payload?.issue;
  const timestamp = payload?.timestamp || Date.now();

  const projectKey = (
    issue?.fields?.project?.key ||
    (issue?.key ? issue.key.split('-')[0] : '') ||
    payload?.project?.key ||
    (payload?.comment?.issue?.key ? payload.comment.issue.key.split('-')[0] : '')
  )?.toUpperCase();

  if (!projectKey) {
    logger.warn(`Rejected Jira webhook event "${webhookEvent}": Cannot extract project key from payload`);
    return { error: 'Cannot identify organization from webhook payload' };
  }

  const integration = await prisma.orgJiraIntegration.findFirst({
    where: { projectKey, isActive: true },
  });

  if (!integration || !integration.encryptedWebhookSecret) {
    logger.warn(`Rejected Jira webhook event "${webhookEvent}": No active integration or secret found for project "${projectKey}"`);
    return { error: 'No active Jira integration or webhook secret found for this project' };
  }

  let secret: string | null = null;
  try {
    secret = decryptJiraToken(integration.encryptedWebhookSecret);
  } catch (err: any) {
    logger.error(`Failed to decrypt webhook secret for org ${integration.organizationId}: ${err.message}`);
    return { error: 'Failed to decrypt webhook secret' };
  }

  if (!secret) {
    return { error: 'No webhook secret configured for this organization' };
  }

  const isSignatureValid = verifyWebhookSignature(rawBody, signatureHeader, secret);

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
    try {
      const assigneeAccountId = issue.fields?.assignee?.accountId;

      const assigneeChangedInUpdate =
        webhookEvent === 'jira:issue_updated' &&
        Array.isArray(payload?.changelog?.items) &&
        payload.changelog.items.some(
          (item: any) => item.field === 'assignee' && item.to
        );

      const createdWithAssignee =
        webhookEvent === 'jira:issue_created' && assigneeAccountId;

      if (assigneeAccountId && (assigneeChangedInUpdate || createdWithAssignee)) {
        const assigneeLink = await prisma.userJiraLink.findFirst({
          where: { jiraAccountId: assigneeAccountId },
          select: { userId: true },
        });

        if (assigneeLink) {
          const jiraUrl = integration.siteUrl
            ? `${integration.siteUrl}/browse/${cleanKey}`
            : null;

          await prisma.notification.create({
            data: {
              recipientId: assigneeLink.userId,
              type: 'SYSTEM',
              title: `Assigned: ${cleanKey}`,
              body: newSummary
                ? `You've been assigned to "${newSummary}" in Jira.`
                : `You've been assigned ticket ${cleanKey} in Jira.`,
              data: {
                source: 'jira',
                jiraKey: cleanKey,
                jiraStatus: newStatus || null,
                jiraUrl,
              },
            },
          });

          logger.info(`Notified user ${assigneeLink.userId} of Jira assignment: ${cleanKey}`);
        }
      }
    } catch (notifErr: any) {
      logger.warn(`Failed to send Jira assignment notification for ${cleanKey}: ${notifErr.message}`);
    }
  }

  return { success: true, eventId };
}
