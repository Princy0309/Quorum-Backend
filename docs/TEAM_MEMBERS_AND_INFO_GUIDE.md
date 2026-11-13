# 👥 Quorum - Team Info & Members Integration Guide (Mobile & Web)

This guide documents the **Team Information & Member Directory** feature — functioning exactly like WhatsApp / Slack group info. When a user taps the team header inside a team chat, this feature displays team details, the list of members (sorted with Team Leads first), member roles, and allows members to self-leave or team leads/admins to manage members.

---

## 1. User Experience Flow (WhatsApp / Slack Style)

1. **Header Tap in Team Chat (`Dev Team(Frontend) • 4 members`)**:
   - Tapping the team name or member count at the top bar opens the **Team Info** modal / screen.
2. **Team Info Header**:
   - Team avatar/icon, Team Name, and Team Description.
   - Member count badge (e.g. `4 members`).
3. **Members Section**:
   - **Search Bar**: Live search filter for members by name or email.
   - **Leader First Priority**: Team Leads (`LEAD`) appear at the very top with a prominent green badge (`Team Lead` / `Group Admin`).
   - **Organization Role Badge**: Displays their organization role (`Admin`, `Team Head`, or `Member`).
   - **Tapping a Member**: Opens their profile card (Avatar, Name, Email, Organization Role, Joined Date, and a 1-on-1 "Message" button).
4. **Action Buttons**:
   - **If Team Lead / Org Admin**: Shows an `[+ Add Member]` button and a 3-dot menu on member rows (`Remove from team`).
   - **If Regular Member**: Shows a red `[🚪 Leave Team]` button at the bottom.

---

## 2. API Endpoints Reference

### A. Get Team Members List (With Search, Role Filter & Sorting)
Fetches all members in a team. Team Leads are sorted first automatically, followed by members.

- **Method / Path:** `GET /api/v1/organizations/:id/teams/:teamId/members`
- **Auth:** Bearer Token (`requireOrgMember` - any org member can view)
- **Query Parameters:**
  - `search` *(optional, string)*: Filter by member name or email (e.g. `?search=tushar`).
  - `role` *(optional, string)*: Filter by team role: `LEAD` or `MEMBER`.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "totalCount": 4,
    "members": [
      {
        "id": "team_member_uuid_1",
        "userId": "user_uuid_1",
        "teamRole": "LEAD",
        "organizationRole": "ORG_ADMIN",
        "joinedAt": "2026-10-31T10:00:00.000Z",
        "user": {
          "id": "user_uuid_1",
          "name": "Princy Mishra",
          "email": "princyyy03@gmail.com",
          "avatar": "https://...",
          "orgJoinedAt": "2026-10-01T08:00:00.000Z"
        }
      },
      {
        "id": "team_member_uuid_2",
        "userId": "user_uuid_2",
        "teamRole": "LEAD",
        "organizationRole": "TEAM_HEAD",
        "joinedAt": "2026-10-31T11:00:00.000Z",
        "user": {
          "id": "user_uuid_2",
          "name": "tushar",
          "email": "yogendrasingh975926@gmail.com",
          "avatar": "https://...",
          "orgJoinedAt": "2026-10-31T08:00:00.000Z"
        }
      },
      {
        "id": "team_member_uuid_3",
        "userId": "user_uuid_3",
        "teamRole": "MEMBER",
        "organizationRole": "MEMBER",
        "joinedAt": "2026-11-01T09:30:00.000Z",
        "user": {
          "id": "user_uuid_3",
          "name": "jay",
          "email": "jaytestgmail123@gmail.com",
          "avatar": null,
          "orgJoinedAt": "2026-10-15T09:00:00.000Z"
        }
      }
    ]
  }
}
```

---

### B. Leave Team (For Any Member)
Allows the authenticated user to leave the team voluntarily. Emits a system message `"<User> left the team"` into the team chat and cleans up conversation participants automatically.

- **Method / Path:** `POST /api/v1/organizations/:id/teams/:teamId/leave`
- **Auth:** Bearer Token (`requireOrgMember` - any team member can call)
- **Request Body:** `{}` (empty)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Successfully left the team"
}
```

---

### C. Remove Member (Admin / Lead Action)
Allows Team Leads of this team or Organization Admins to kick a member out of the team.

- **Method / Path:** `DELETE /api/v1/organizations/:id/teams/:teamId/members/:userId`
- **Auth:** Bearer Token (Caller must be Org Admin or Lead of this team)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Member removed from team successfully"
}
```

---

### D. Add Member to Team
Adds an organization member to the team as either `MEMBER` or `LEAD`.

- **Method / Path:** `POST /api/v1/organizations/:id/teams/:teamId/members`
- **Auth:** Bearer Token (Caller must be Org Admin or Team Head)
- **Request Body:**
```json
{
  "userId": "user_uuid_here",
  "role": "MEMBER" // or "LEAD"
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "id": "team_member_uuid",
    "teamId": "team_uuid",
    "userId": "user_uuid",
    "role": "MEMBER",
    "joinedAt": "2026-11-12T17:00:00.000Z"
  }
}
```

---

## 3. Frontend & Mobile UI State Wiring

```typescript
// 1. Fetching members when opening Team Info modal
async function loadTeamMembers(orgId: string, teamId: string, searchQuery = '') {
  const query = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : '';
  const res = await api.get(`/organizations/${orgId}/teams/${teamId}/members${query}`);
  return res.data.data.members;
}

// 2. Leaving the team
async function handleLeaveTeam(orgId: string, teamId: string) {
  const confirmed = await showConfirmDialog({
    title: 'Leave Team?',
    message: 'Are you sure you want to leave this team? You will lose access to team discussions and tasks.'
  });
  if (!confirmed) return;

  await api.post(`/organizations/${orgId}/teams/${teamId}/leave`);
  toast.success('You left the team');
  navigation.navigate('OrganizationScreen');
}
```
