import type { OrgPostCategory } from '@prisma/client';

export interface CreateOrgPostInput {
  category?: OrgPostCategory;
  title?: string | null;
  content?: string;
  fileUrl?: string | null;
  fileType?: 'image' | 'file' | 'document' | null;
  fileName?: string | null;
  fileSize?: number | null;
  targetUserId?: string | null;
  targetTeamId?: string | null;
  mentionedUserIds?: string[];
}

export interface UpdateOrgPostInput {
  category?: OrgPostCategory;
  title?: string | null;
  content?: string;
  fileUrl?: string | null;
  fileType?: 'image' | 'file' | 'document' | null;
  fileName?: string | null;
  fileSize?: number | null;
  targetUserId?: string | null;
  targetTeamId?: string | null;
  mentionedUserIds?: string[];
}

export interface GetOrgFeedQuery {
  category?: OrgPostCategory;
  teamId?: string;
  search?: string;
  pinnedOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export interface CreateOrgCommentInput {
  content: string;
  parentId?: string | null;
}

export interface UpdateOrgCommentInput {
  content: string;
}

export interface OrgFeedReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}