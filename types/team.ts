export interface CreateTeamInput {
  name: string;
  description?: string;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
}
