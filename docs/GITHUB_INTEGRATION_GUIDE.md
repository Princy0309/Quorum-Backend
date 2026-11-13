# 🐙 Quorum - GitHub Integration Guide (Mobile & Web)

This guide documents the updates from the **`fix/github-status-refreshable`** branch (already merged into `dev`). It details how the frontend should handle GitHub connection statuses, team access checks, error handling (rate limit vs permissions), and all team-scoped repository/issue/PR endpoints.

---

## 1. 🔑 GitHub Connection Status & Token States

### Endpoint: `GET /api/v1/github/status` (or `/api/v1/github/oauth/status`)
- **Auth:** Bearer Token (Authenticated user)

### Response Body:
```json
{
  "success": true,
  "message": "GitHub status retrieved",
  "data": {
    "connected": true,
    "status": "active", // "active" | "refreshable" | "expired"
    "githubUsername": "princymishra",
    "githubEmail": "princyyy03@gmail.com",
    "connectedAt": "2026-11-10T17:35:16.000Z",
    "tokenExpiresAt": "2026-11-14T05:00:00.000Z"
  }
}
```
*(If not connected, returns `{ "connected": false }`)*.

---

### 🎨 How Frontend Should Handle the `status` Field:

| Status Value | Meaning | UI State on Mobile & Web |
| :--- | :--- | :--- |
| **`"active"`** | Token is fresh and fully functional. | 🟢 **Green badge:** "Connected as `@username`" with a `[Disconnect]` button. |
| **`"refreshable"`** | Access token is expired, but backend has a valid refresh token. Backend will **automatically rotate tokens** on the next API call. | 🟡 **Yellow badge:** "Connected" (or "Refreshing session"). No user action required! |
| **`"expired"`** | Token has expired or been revoked in GitHub settings, and cannot be auto-refreshed. | 🔴 **Red badge / Alert:** "GitHub session expired. Please reconnect." Show a `[Reconnect GitHub]` button pointing to the OAuth flow. |

---

## 2. 🛡️ Team Membership Enforcement (`assertTeamAccess`)

All team-scoped GitHub endpoints (`/teams/:teamId/*`) now strictly enforce security:
* A user **MUST be a member of that specific team** OR an **Organization Admin (`ORG_ADMIN`)**.
* If a non-member tries to view or manage the team's GitHub repository:
  - **Status Code:** `403 Forbidden`
  - **Response:**
  ```json
  {
    "success": false,
    "statusCode": 403,
    "message": "You must be a team member or Org Admin to access this team"
  }
  ```

### 📱 Frontend UI Recommendation:
- If `currentUser` is not in the team (and not Org Admin), hide or disable the GitHub tab inside the team view:
  > *"Join this team to view linked repositories, issues, and pull requests."*

---

## 3. ⚠️ Error Handling: Rate Limit (`429`) vs Permission Denied (`403`)

The backend now clearly differentiates GitHub rate limits from repo permission errors:

### Case A: GitHub Rate Limit Exceeded (`429 Too Many Requests`)
When GitHub's API rate limit is reached:
- **HTTP Status:** `429`
- **Response:**
  ```json
  {
    "success": false,
    "statusCode": 429,
    "message": "GitHub rate limit reached. Please try again after 1:15:00 PM."
  }
  ```
- **Frontend Action:** Display a toast or banner: *"GitHub is rate limited. Please wait until [Time] to refresh."*

### Case B: GitHub Permission Denied (`403 Forbidden`)
When the user's connected GitHub account doesn't have read/write permission to the repository:
- **HTTP Status:** `403`
- **Response:**
  ```json
  {
    "success": false,
    "statusCode": 403,
    "message": "GitHub denied the request. Check your repository permissions or OAuth scopes."
  }
  ```
- **Frontend Action:** Display a banner: *"Insufficient GitHub permissions for this repository. Ensure your GitHub account has collaborator access."*

---

## 4. 📚 Complete GitHub Endpoints Reference

Base URL: `/api/v1/github`

### A. OAuth & Account Connection
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/oauth/authorize-url` | Returns `{ url }` to start GitHub OAuth in browser |
| `GET` | `/oauth/status` | Returns `{ connected, status, githubUsername, ... }` |
| `POST` | `/disconnect` | Disconnects GitHub account and deletes stored tokens |

### B. User & Team Repositories
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/user/repos?page=1&perPage=30` | Lists repos accessible by the connected user (to pick for linking) |
| `POST` | `/teams/:teamId/repo` | Links repo to team. Body: `{ "repoFullName": "owner/repo" }` |
| `GET` | `/teams/:teamId/repo` | Gets the repo currently linked to this team |
| `DELETE` | `/teams/:teamId/repo` | Unlinks repo from team. Body: `{ "repoFullName": "owner/repo" }` |

### C. Team Issues & Bug Tracking
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/teams/:teamId/issues?state=open&page=1` | Lists GitHub issues (`state=open`, `closed`, or `all`) |
| `POST` | `/teams/:teamId/issues` | Creates a new issue. Body: `{ "title": "...", "body": "...", "labels": [...] }` |
| `PATCH` | `/teams/:teamId/issues/:issueNumber` | Closes or reopens issue. Body: `{ "state": "closed" }` |

### D. Team Pull Requests & Commits
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/teams/:teamId/pulls?state=open` | Lists pull requests linked to the team repo |
| `GET` | `/teams/:teamId/commits?branch=main` | Lists recent commit history for branch |
| `GET` | `/teams/:teamId/branches` | Lists all branch names in the repository |
| `GET` | `/teams/:teamId/collaborators` | Lists GitHub collaborators for issue assignment |
