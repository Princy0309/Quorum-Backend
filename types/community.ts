export const CommunityRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
} as const;

export type CommunityRole = (typeof CommunityRole)[keyof typeof CommunityRole];

export interface CreateCommunityInput {
  name: string;
  description?: string;
}

export interface UpdateCommunityInput {
  name?: string;
  description?: string;
}
