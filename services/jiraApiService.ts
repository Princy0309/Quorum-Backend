import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { getFreshJiraAccessToken } from './jiraOAuthService.js';

const JIRA_API_BASE = 'https://api.atlassian.com/ex/jira';
const DEFAULT_TIMEOUT_MS = 10000; // 10s strict timeout to prevent hanging

export interface JiraApiRequestOptions {
  cloudId: string;
  userId: string;
  endpoint: string; 
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  retryOn401?: boolean; 
}

export async function callJiraApi<T = any>(options: JiraApiRequestOptions): Promise<T> {
  const {
    cloudId,
    userId,
    endpoint,
    method = 'GET',
    body,
    retryOn401 = true,
  } = options;

  if (!cloudId) {
    throw new ApiError(400, 'Jira Cloud ID is required to make an API call');
  }
  if (!userId) {
    throw new ApiError(400, 'User ID is required to authenticate Jira API call');
  }

  const accessToken = await getFreshJiraAccessToken(userId);
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const url = `${JIRA_API_BASE}/${cloudId}/rest/api/3/${cleanEndpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  };

  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err: any) {
    logger.error('Jira API request failed at network level:', { url, method, error: err.message });
    throw new ApiError(504, 'Jira API request timed out or failed to reach Atlassian');
  }

  if (response.status === 401 && retryOn401) {
    logger.warn(`Jira API returned 401 for user ${userId}. Retrying with fresh token...`);
    return callJiraApi<T>({
      ...options,
      retryOn401: false,
    });
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || '5';
    throw new ApiError(429, `Jira rate limit exceeded. Retry after ${retryAfter} seconds.`);
  }

  if (response.status === 403) {
    throw new ApiError(403, 'Forbidden: Your Jira account lacks permission for this action.');
  }

  if (response.status === 404) {
    throw new ApiError(404, 'The requested Jira project, ticket, or resource was not found.');
  }

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Jira API error response:', { status: response.status, body: errorText });
    let detail = response.statusText;
    try {
      const parsed = JSON.parse(errorText);
      const errMsgs = parsed.errorMessages || [];
      const fieldErrors = parsed.errors ? Object.entries(parsed.errors).map(([k, v]) => `${k}: ${v}`) : [];
      detail = [...errMsgs, ...fieldErrors].join('; ') || response.statusText;
    } catch {
      detail = errorText.slice(0, 150) || response.statusText;
    }
    throw new ApiError(response.status, `Jira API error: ${detail}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

export async function getJiraProject(cloudId: string, userId: string, projectKey: string) {
  return callJiraApi({
    cloudId,
    userId,
    endpoint: `/project/${encodeURIComponent(projectKey)}`,
    method: 'GET',
  });
}

export async function getJiraIssue(cloudId: string, userId: string, issueKey: string) {
  return callJiraApi({
    cloudId,
    userId,
    endpoint: `/issue/${encodeURIComponent(issueKey)}`,
    method: 'GET',
  });
}

export async function getJiraTransitions(cloudId: string, userId: string, issueKey: string) {
  return callJiraApi({
    cloudId,
    userId,
    endpoint: `/issue/${encodeURIComponent(issueKey)}/transitions`,
    method: 'GET',
  });
}

export async function getJiraAssignableUsers(cloudId: string, userId: string, projectKey: string) {
  return callJiraApi<Array<any>>({
    cloudId,
    userId,
    endpoint: `/user/assignable/search?project=${encodeURIComponent(projectKey)}`,
    method: 'GET',
  });
}


