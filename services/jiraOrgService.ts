import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { getJiraProject } from './jiraApiService.js';

export async function setupOrgJiraIntegration(
  userId: string,
  organizationId: string,
  projectKey: string
) {
  if (!organizationId) {
    throw new ApiError(400, 'Organization ID is required');
  }
  if (!projectKey || typeof projectKey !== 'string') {
    throw new ApiError(400, 'A valid Jira projectKey is required (e.g. "DEV")');
  }

  const cleanProjectKey = projectKey.trim().toUpperCase();

  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId,
      organizationId,
      role: 'ORG_ADMIN',
    },
  });

  if (!membership) {
    throw new ApiError(403, 'Only an Organization Admin can configure Jira integrations');
  }

  const userJiraLink = await prisma.userJiraLink.findUnique({
    where: { userId },
  });

  if (!userJiraLink || !userJiraLink.cloudId) {
    throw new ApiError(
      400,
      'You must connect your personal Jira account first before setting up organization integration'
    );
  }

  try {
    await getJiraProject(userJiraLink.cloudId, userId, cleanProjectKey);
  } catch (err: any) {
    if (err.statusCode === 404) {
      throw new ApiError(404, `Jira project "${cleanProjectKey}" was not found in your Jira workspace`);
    }
    throw new ApiError(err.statusCode || 500, `Failed to verify Jira project: ${err.message}`);
  }

  const integration = await prisma.orgJiraIntegration.upsert({
    where: { organizationId },
    create: {
      organizationId,
      cloudId: userJiraLink.cloudId,
      siteUrl: userJiraLink.siteUrl || '',
      projectKey: cleanProjectKey,
      installedByUserId: userId,
      isActive: true,
    },
    update: {
      cloudId: userJiraLink.cloudId,
      siteUrl: userJiraLink.siteUrl || '',
      projectKey: cleanProjectKey,
      installedByUserId: userId,
      isActive: true,
    },
  });

  logger.info(`Org ${organizationId} linked to Jira project ${cleanProjectKey} by admin ${userId}`);

  return {
    organizationId: integration.organizationId,
    cloudId: integration.cloudId,
    siteUrl: integration.siteUrl,
    projectKey: integration.projectKey,
    isActive: integration.isActive,
  };
}

export async function getOrgJiraIntegration(userId: string, organizationId: string) {
  if (!organizationId) {
    throw new ApiError(400, 'Organization ID is required');
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId,
      organizationId,
    },
  });

  if (!membership) {
    throw new ApiError(403, 'You are not a member of this organization');
  }

  // Check if current user has connected their personal Jira account (Step 1 prerequisite)
  const userJiraLink = await prisma.userJiraLink.findUnique({
    where: { userId },
    select: { id: true, cloudId: true, siteUrl: true, jiraEmail: true },
  });

  const integration = await prisma.orgJiraIntegration.findUnique({
    where: { organizationId },
    select: {
      id: true,
      organizationId: true,
      cloudId: true,
      siteUrl: true,
      projectKey: true,
      isActive: true,
      installedByUserId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // If organization has not configured Jira yet, return clean isConnected: false
  // along with userConnected status to inform frontend whether admin needs OAuth first.
  if (!integration || !integration.isActive) {
    return {
      isConnected: false,
      userConnected: !!userJiraLink,
      userEmail: userJiraLink?.jiraEmail || null,
    };
  }

  return {
    isConnected: true,
    userConnected: !!userJiraLink,
    userEmail: userJiraLink?.jiraEmail || null,
    ...integration,
  };
}

export async function disconnectOrgJiraIntegration(userId: string, organizationId: string) {
  if (!organizationId) {
    throw new ApiError(400, 'Organization ID is required');
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId,
      organizationId,
      role: 'ORG_ADMIN',
    },
  });

  if (!membership) {
    throw new ApiError(403, 'Only an Organization Admin can disconnect Jira integration');
  }

  const existing = await prisma.orgJiraIntegration.findUnique({
    where: { organizationId },
  });

  if (!existing) {
    return { disconnected: true, message: 'No integration was active' };
  }

  await prisma.orgJiraIntegration.delete({
    where: { organizationId },
  });

  logger.info(`Org ${organizationId} Jira integration removed by admin ${userId}`);

  return { disconnected: true };
}
