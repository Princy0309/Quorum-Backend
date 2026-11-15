export interface CreateTeamInput {
  name: string;
  description?: string;
  avatar?: string | null;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  avatar?: string | null;
}
