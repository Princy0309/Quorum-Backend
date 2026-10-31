import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { callJiraApi, getJiraTransitions, getJiraAssignableUsers } from './jiraApiService.js';

export interface CreateTicketInput {
  summary: string;
  description?: string;
  issueType?: string;
  priority?: string;
  assigneeAccountId?: string;
}

export function toAtlassianDocument(plainText?: string) {
  if (!plainText || plainText.trim().length === 0) {
    return null;
  }

  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: plainText.trim(),
          },
        ],
      },
    ],
  };
}

export async function createTeamJiraTicket(
  userId: string,
  teamId: string,
  input: CreateTicketInput
) {
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }
  if (!input.summary || input.summary.trim().length === 0) {
    throw new ApiError(400, 'Ticket summary (title) is required');
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, organizationId: true },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found');
  }

  const isTeamMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  });

  const isOrgAdmin = await prisma.organizationMember.findFirst({
    where: {
      organizationId: team.organizationId,
      userId,
      role: 'ORG_ADMIN',
    },
  });

  if (!isTeamMember && !isOrgAdmin) {
    throw new ApiError(403, 'You must be a team member or Org Admin to create tickets for this team');
  }

  const orgIntegration = await prisma.orgJiraIntegration.findUnique({
    where: { organizationId: team.organizationId },
  });

  if (!orgIntegration || !orgIntegration.isActive) {
    throw new ApiError(
      400,
      'Jira is not integrated for this organization. An Org Admin must connect Jira in organization settings first.'
    );
  }

  const userJiraLink = await prisma.userJiraLink.findUnique({
    where: { userId },
  });

  if (!userJiraLink) {
    throw new ApiError(
      400,
      'Please connect your personal Jira account in user settings before creating tickets'
    );
  }

  const fields: Record<string, any> = {
    project: {
      key: orgIntegration.projectKey,
    },
    summary: input.summary.trim(),
    issuetype: {
      name: input.issueType || 'Task',
    },
  };

  const adfDescription = toAtlassianDocument(input.description);
  if (adfDescription) {
    fields.description = adfDescription;
  }

  if (input.priority) {
    fields.priority = { name: input.priority };
  }

  // Resolve assignee: handle Atlassian accountId, Quorum userId, email, or "Unassigned"
  let resolvedAccountId: string | null = null;
  const rawAssignee = input.assigneeAccountId?.trim();

  if (rawAssignee && !['unassigned', 'none', 'null', 'undefined', ''].includes(rawAssignee.toLowerCase())) {
    if (rawAssignee.includes(':') || /^[a-f0-9]{24}$/i.test(rawAssignee)) {
      resolvedAccountId = rawAssignee;
    } else {
      // Check if it's a Quorum userId
      const userRecord = await prisma.user.findUnique({
        where: { id: rawAssignee },
        include: { jiraLink: true },
      });
      if (userRecord?.jiraLink?.jiraAccountId) {
        resolvedAccountId = userRecord.jiraLink.jiraAccountId;
      } else if (rawAssignee.includes('@')) {
        // Check if it's an email
        const linkByEmail = await prisma.userJiraLink.findFirst({
          where: { jiraEmail: rawAssignee },
        });
        if (linkByEmail?.jiraAccountId) {
          resolvedAccountId = linkByEmail.jiraAccountId;
        }
      } else {
        // Fallback: check by display name
        const linkByName = await prisma.userJiraLink.findFirst({
          where: { jiraDisplayName: { equals: rawAssignee, mode: 'insensitive' } },
        });
        if (linkByName?.jiraAccountId) {
          resolvedAccountId = linkByName.jiraAccountId;
        } else {
          resolvedAccountId = rawAssignee;
        }
      }
    }
  }

  if (resolvedAccountId) {
    fields.assignee = { accountId: resolvedAccountId };
  }

  let jiraIssue: { id: string; key: string; self: string };
  try {
    jiraIssue = await callJiraApi<{ id: string; key: string; self: string }>({
      cloudId: orgIntegration.cloudId,
      userId,
      endpoint: '/issue',
      method: 'POST',
      body: { fields },
    });
  } catch (err: any) {
    // If Atlassian rejected the ticket because of the assignee, retry once as unassigned so creation succeeds!
    if (fields.assignee) {
      logger.warn(`Jira ticket creation failed with assignee (${resolvedAccountId}), retrying as unassigned: ${err.message}`);
      delete fields.assignee;
      jiraIssue = await callJiraApi<{ id: string; key: string; self: string }>({
        cloudId: orgIntegration.cloudId,
        userId,
        endpoint: '/issue',
        method: 'POST',
        body: { fields },
      });
      resolvedAccountId = null;
    } else {
      throw err;
    }
  }

  const createdLink = await prisma.jiraTicketLink.create({
    data: {
      teamId,
      jiraIssueId: jiraIssue.id,
      jiraKey: jiraIssue.key,
      jiraSummary: input.summary.trim(),
      jiraStatus: 'To Do',
      assigneeAccountId: resolvedAccountId || null,
      reporterAccountId: userJiraLink.jiraAccountId,
      priority: input.priority || 'Medium',
    },
  });

  logger.info(`Jira ticket ${jiraIssue.key} created for team ${teamId} by user ${userId}`);

  return createdLink;
}

export async function getTeamJiraTickets(userId: string, teamId: string) {
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, organizationId: true },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found');
  }

  const isTeamMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  });

  const isOrgAdmin = await prisma.organizationMember.findFirst({
    where: {
      organizationId: team.organizationId,
      userId,
      role: 'ORG_ADMIN',
    },
  });

  if (!isTeamMember && !isOrgAdmin) {
    throw new ApiError(403, 'You must be a team member or Org Admin to view this team tickets');
  }

  const tickets = await prisma.jiraTicketLink.findMany({
    where: { teamId },
    orderBy: { createdAt: 'desc' },
  });

  return tickets;
}

export async function getJiraTicketDetails(userId: string, teamId: string, jiraKey: string) {
  if (!teamId || !jiraKey) {
    throw new ApiError(400, 'Team ID and Jira issue key are required');
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, organizationId: true },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found');
  }

  const isTeamMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  });

  const isOrgAdmin = await prisma.organizationMember.findFirst({
    where: {
      organizationId: team.organizationId,
      userId,
      role: 'ORG_ADMIN',
    },
  });

  if (!isTeamMember && !isOrgAdmin) {
    throw new ApiError(403, 'You must be a team member or Org Admin to view this ticket');
  }

  const ticket = await prisma.jiraTicketLink.findUnique({
    where: {
      teamId_jiraKey: {
        teamId,
        jiraKey: jiraKey.toUpperCase(),
      },
    },
  });

  if (!ticket) {
    throw new ApiError(404, `Ticket ${jiraKey} not found in this team`);
  }

  return ticket;
}

export async function transitionJiraTicketStatus(
  userId: string,
  teamId: string,
  jiraKey: string,
  targetStatus: string
) {
  if (!teamId || !jiraKey || !targetStatus) {
    throw new ApiError(400, 'Team ID, Jira issue key, and targetStatus are required');
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, organizationId: true },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found');
  }

  const isTeamMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  });

  const isOrgAdmin = await prisma.organizationMember.findFirst({
    where: {
      organizationId: team.organizationId,
      userId,
      role: 'ORG_ADMIN',
    },
  });

  if (!isTeamMember && !isOrgAdmin) {
    throw new ApiError(403, 'You must be a team member or Org Admin to transition tickets');
  }

  const orgIntegration = await prisma.orgJiraIntegration.findUnique({
    where: { organizationId: team.organizationId },
  });

  if (!orgIntegration || !orgIntegration.isActive) {
    throw new ApiError(400, 'Jira is not integrated for this organization');
  }

  const userJiraLink = await prisma.userJiraLink.findUnique({
    where: { userId },
  });

  if (!userJiraLink) {
    throw new ApiError(400, 'Please connect your personal Jira account to update ticket statuses');
  }

  const cleanKey = jiraKey.toUpperCase();

  const transitionsData = await getJiraTransitions(
    orgIntegration.cloudId,
    userId,
    cleanKey
  );

  const availableTransitions = (transitionsData?.transitions || []) as Array<{
    id: string;
    name: string;
    to: { name: string };
  }>;

  const targetLower = targetStatus.trim().toLowerCase();
  const matchedTransition = availableTransitions.find(
    (t) =>
      t.name.toLowerCase() === targetLower ||
      t.to.name.toLowerCase() === targetLower
  );

  if (!matchedTransition) {
    const validNames = availableTransitions.map((t) => `"${t.to.name}"`).join(', ');
    throw new ApiError(
      400,
      `Cannot move ticket to "${targetStatus}". Available transitions in Jira right now: ${validNames || 'None'}`
    );
  }

  await callJiraApi({
    cloudId: orgIntegration.cloudId,
    userId,
    endpoint: `/issue/${cleanKey}/transitions`,
    method: 'POST',
    body: {
      transition: {
        id: matchedTransition.id,
      },
    },
  });

  const updatedTicket = await prisma.jiraTicketLink.update({
    where: {
      teamId_jiraKey: {
        teamId,
        jiraKey: cleanKey,
      },
    },
    data: {
      jiraStatus: matchedTransition.to.name,
      lastSyncedAt: new Date(),
    },
  });

  logger.info(`Ticket ${cleanKey} transitioned to "${matchedTransition.to.name}" by user ${userId}`);

  return updatedTicket;
}

export async function getMyAssignedJiraTickets(userId: string) {
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const userJiraLink = await prisma.userJiraLink.findUnique({
    where: { userId },
  });

  if (!userJiraLink || !userJiraLink.jiraAccountId) {
    return [];
  }

  const tickets = await prisma.jiraTicketLink.findMany({
    where: {
      assigneeAccountId: userJiraLink.jiraAccountId,
    },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          organizationId: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  return tickets;
}

export async function getTeamJiraAssignees(userId: string, teamId: string) {
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required');
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, organizationId: true },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found');
  }

  const isTeamMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  });

  const isOrgAdmin = await prisma.organizationMember.findFirst({
    where: {
      organizationId: team.organizationId,
      userId,
      role: 'ORG_ADMIN',
    },
  });

  if (!isTeamMember && !isOrgAdmin) {
    throw new ApiError(403, 'You must be a team member or Org Admin to view assignees');
  }

  const orgIntegration = await prisma.orgJiraIntegration.findUnique({
    where: { organizationId: team.organizationId },
  });

  if (!orgIntegration || !orgIntegration.isActive) {
    return [];
  }

  // 1. Fetch team members and org admins so ONLY this team's members appear in the dropdown
  const [teamMembers, orgAdmins] = await Promise.all([
    prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            jiraLink: {
              select: {
                jiraAccountId: true,
                jiraEmail: true,
              },
            },
          },
        },
      },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: team.organizationId, role: 'ORG_ADMIN' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            jiraLink: {
              select: {
                jiraAccountId: true,
                jiraEmail: true,
              },
            },
          },
        },
      },
    }),
  ]);

  // Set of allowed emails and accountIds for this team (including Org Admins)
  const allowedEmails = new Set<string>();
  const allowedAccountIds = new Set<string>();

  for (const m of [...teamMembers, ...orgAdmins]) {
    if (m.user.email) allowedEmails.add(m.user.email.toLowerCase());
    if (m.user.jiraLink?.jiraEmail) allowedEmails.add(m.user.jiraLink.jiraEmail.toLowerCase());
    if (m.user.jiraLink?.jiraAccountId) allowedAccountIds.add(m.user.jiraLink.jiraAccountId);
  }

  try {
    const rawUsers = await getJiraAssignableUsers(
      orgIntegration.cloudId,
      userId,
      orgIntegration.projectKey
    );

    // Filter Atlassian assignees so only members of THIS team (and Org Admin) appear
    const filtered = (rawUsers || []).filter((u: any) => {
      const email = u.emailAddress?.toLowerCase();
      const accountId = u.accountId;
      return (email && allowedEmails.has(email)) || (accountId && allowedAccountIds.has(accountId));
    });

    const finalUsers = filtered.length > 0 ? filtered : (rawUsers || []);

    return finalUsers.map((u: any) => ({
      accountId: u.accountId,
      displayName: u.displayName || u.name,
      email: u.emailAddress || null,
      avatarUrl: u.avatarUrls?.['48x48'] || u.avatarUrls?.['32x32'] || u.avatarUrls?.['24x24'] || null,
      active: u.active ?? true,
    }));
  } catch (err: any) {

    logger.warn(`Failed to fetch assignable users from Jira: ${err.message}`);
    // Graceful fallback to Quorum team members who have linked Jira
    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            jiraLink: {
              select: {
                jiraAccountId: true,
                jiraDisplayName: true,
                jiraEmail: true,
              },
            },
          },
        },
      },
    });

    return teamMembers
      .filter((m) => m.user.jiraLink?.jiraAccountId)
      .map((m) => ({
        accountId: m.user.jiraLink!.jiraAccountId,
        displayName: m.user.jiraLink!.jiraDisplayName || m.user.name,
        email: m.user.jiraLink!.jiraEmail || m.user.email,
        active: true,
      }));
  }
}

export async function getOrgJiraAssignees(userId: string, organizationId: string) {
  if (!organizationId) {
    throw new ApiError(400, 'Organization ID is required');
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { organizationId, userId },
  });

  if (!membership) {
    throw new ApiError(403, 'You must be an organization member to view assignees');
  }

  const orgIntegration = await prisma.orgJiraIntegration.findUnique({
    where: { organizationId },
  });

  if (!orgIntegration || !orgIntegration.isActive) {
    return [];
  }

  try {
    const rawUsers = await getJiraAssignableUsers(
      orgIntegration.cloudId,
      userId,
      orgIntegration.projectKey
    );

    return (rawUsers || []).map((u: any) => ({
      accountId: u.accountId,
      displayName: u.displayName || u.name,
      email: u.emailAddress || null,
      avatarUrl: u.avatarUrls?.['48x48'] || u.avatarUrls?.['32x32'] || u.avatarUrls?.['24x24'] || null,
      active: u.active ?? true,
    }));
  } catch (err: any) {
    logger.warn(`Failed to fetch assignable users for org: ${err.message}`);
    return [];
  }
}




