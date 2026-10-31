import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createTeamJiraTicket,
  getTeamJiraTickets,
  getJiraTicketDetails,
  transitionJiraTicketStatus,
  getMyAssignedJiraTickets,
  getTeamJiraAssignees,
  getOrgJiraAssignees,
} from '../services/jiraTicketService.js';

const createTicketSchema = z.object({
  summary: z.string().min(1, 'Ticket summary is required'),
  description: z.string().optional(),
  issueType: z.string().optional(),
  priority: z.string().optional(),
  assigneeAccountId: z.string().optional(),
});

const transitionStatusSchema = z.object({
  status: z.string().min(1, 'Target status is required (e.g. "Done" or "In Progress")'),
});

export const createTeamTicketController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required in URL parameters');
  }

  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    throw new ApiError(400, errorMsg);
  }

  const ticket = await createTeamJiraTicket(userId, teamId, parsed.data);
  return sendSuccess(res, 201, 'Jira ticket created successfully', ticket);
});

export const getTeamTicketsController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  if (!teamId) {
    throw new ApiError(400, 'Team ID is required in URL parameters');
  }

  const tickets = await getTeamJiraTickets(userId, teamId);
  return sendSuccess(res, 200, 'Team Jira tickets retrieved', tickets);
});

export const getTicketDetailsController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const jiraKey = req.params.key as string;

  if (!teamId || !jiraKey) {
    throw new ApiError(400, 'Team ID and Jira key are required');
  }

  const ticket = await getJiraTicketDetails(userId, teamId, jiraKey);
  return sendSuccess(res, 200, 'Jira ticket details retrieved', ticket);
});

export const transitionTicketStatusController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const jiraKey = req.params.key as string;

  if (!teamId || !jiraKey) {
    throw new ApiError(400, 'Team ID and Jira key are required');
  }

  const parsed = transitionStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    throw new ApiError(400, errorMsg);
  }

  const updatedTicket = await transitionJiraTicketStatus(
    userId,
    teamId,
    jiraKey,
    parsed.data.status
  );
  return sendSuccess(res, 200, 'Jira ticket status updated successfully', updatedTicket);
});

export const getMyTicketsController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const tickets = await getMyAssignedJiraTickets(userId);
  return sendSuccess(res, 200, 'My assigned Jira tickets retrieved', tickets);
});

export const getTeamAssigneesController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = (req.params.teamId || req.params.id) as string;
  const organizationId = (req.params.id || req.params.organizationId) as string;

  if (teamId && req.params.teamId) {
    const assignees = await getTeamJiraAssignees(userId, teamId);
    return sendSuccess(res, 200, 'Team Jira assignees retrieved', assignees);
  } else if (organizationId) {
    const assignees = await getOrgJiraAssignees(userId, organizationId);
    return sendSuccess(res, 200, 'Organization Jira assignees retrieved', assignees);
  } else {
    throw new ApiError(400, 'Team ID or Organization ID is required in URL parameters');
  }
});


