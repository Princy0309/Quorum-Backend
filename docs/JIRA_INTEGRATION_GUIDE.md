# 🎯 Quorum - Jira Integration Guide (Mobile & Web)

This guide documents the complete Jira integration endpoints available under `/api/v1/jira` (from branch `fix/jira-routes-wired`).

---

## 1. Authentication & OAuth Connection

Connect or disconnect a user's Atlassian Jira Cloud account.

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/jira/oauth/authorize-url` | Returns the Atlassian OAuth consent URL | Yes |
| `GET` | `/api/v1/jira/oauth/status` | Returns `{ connected: boolean, cloudId: string, email: string }` | Yes |
| `POST` | `/api/v1/jira/oauth/disconnect` | Disconnects Jira integration | Yes |

---

## 2. Jira Tickets API (Team-Scoped)

### A. List Team Tickets
Returns all Jira issues linked to this team.
- **`GET /api/v1/jira/teams/:teamId/tickets`**
- **Response:**
```json
{
  "success": true,
  "data": [
    {
      "key": "DEV-104",
      "summary": "Fix login modal overflow",
      "status": "In Progress",
      "priority": "High",
      "assignee": {
        "displayName": "Princy Mishra",
        "avatarUrl": "https://..."
      },
      "updatedAt": "2026-11-09T18:00:00.000Z"
    }
  ]
}
```

### B. Create Ticket in Team
Creates a new Jira issue directly from Quorum.
- **`POST /api/v1/jira/teams/:teamId/tickets`**
- **Body:**
```json
{
  "summary": "Crash when uploading large avatar",
  "description": "User gets 413 error without message",
  "issueType": "Bug",
  "assigneeAccountId": "atlassian_account_id_optional"
}
```

### C. Get Ticket Details
- **`GET /api/v1/jira/teams/:teamId/tickets/:key`** (e.g. `/DEV-104`)

### D. Transition Ticket Status (e.g. "To Do" ➡️ "In Progress" ➡️ "Done")
Moves an issue between Jira workflow states.
- **`POST /api/v1/jira/teams/:teamId/tickets/:key/transition`**
- **Body:**
```json
{
  "transitionId": "31" // Or name of transition: "Done"
}
```

### E. Get Team Assignees
Returns available Atlassian assignees for this team/cloud workspace.
- **`GET /api/v1/jira/teams/:teamId/assignees`**

### F. Get My Assigned Tickets
Returns all Jira issues assigned to the authenticated Quorum user across all connected teams.
- **`GET /api/v1/jira/tickets/my`**

---

## 3. Real-Time Webhook Notifications

When a Jira issue is created or assigned to a Quorum user, or its status updates in Jira Cloud:
- Backend receives Atlassian webhook at `/api/v1/jira/webhook`.
- Quorum sends a push notification to the assignee: *"You were assigned to Jira ticket DEV-104: Fix login modal overflow"*.
- If an issue is deleted in Jira, Quorum automatically removes the internal ticket link cleanly.
