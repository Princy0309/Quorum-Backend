# Organization-Wide Feed — Web & Mobile App Integration Guide

This guide covers everything needed for both **Web (React)** and **Mobile App (React Native / Flutter)** teams to integrate Quorum's **Organization-Wide Feed**.

Unlike Team Chats or Team Jira/GitHub integrations (which are private to members of a single team), the **Organization Feed** is shared across the **entire organization** and visible to every `OrganizationMember`.

---

## 1. Base URLs & Authentication

* **Web:** `/api/organizations/:id/feed`
* **Mobile App (`v1`):** `/api/v1/organizations/:id/feed`

**Required on all requests:**
* Valid auth token (`Authorization: Bearer <accessToken>` header or `accessToken` cookie).
* User must be a member of organization `:id` (returns `403` otherwise).

---

## 2. UI Placement & 4-Mode Dynamic Post Composer

### Where it goes in the UI
* **Organization Page:** Add **`Feed`** as the **first tab** right next to `Members` and `Teams` (`Feed | Members (6) | Teams (1)`), so opening an organization lands directly on the shared feed.
* **Controls:** Category filter chips (`All`, `Festivals`, `Milestones`, `Birthdays`, `Pinned`), search bar, optional team dropdown, and a **`+ New Post`** button/FAB.

### Dynamic Post Composer (4 Modes)
At the top of the **"New Organization Post"** modal/sheet, let the user select the post type first so only relevant inputs appear:

1. **🪔 Festival / Official Notice** *(Show only to `ORG_ADMIN` / `TEAM_HEAD`)*
   * **Fields:** `Title` + `Message` + `Poster Image Upload` + optional `Pin to top` toggle
   * **Send:** `category: "FESTIVAL"` or `"ANNOUNCEMENT"`, `title`, `content`, `file` (via `FormData`)
   * *(Note: Poster-only posts with empty `content` are allowed!)*
2. **👥 Team Spotlight (Appreciation or Concern)**
   * **Fields:** `Select Team` + `Tone` (*Milestone/Appreciation* vs *Concern/Update*) + `Title` + `Message`
   * **Send:** `category: "MILESTONE"` *(for appreciation)* or `"ANNOUNCEMENT"` *(for concern/update — Admin/Team Head only)*, `targetTeamId`, `title`, `content`
   * **Notifications:** Selected team members get `"Your team X was appreciated/mentioned"`, while the rest of the org gets `"X reached a milestone!"` or `"Update regarding X"`.
3. **👤 Member Spotlight (Birthday / Promotion / Shoutout)**
   * **Fields:** `Select Member` + `Occasion` (*Birthday / Promotion / Appreciation*) + `Title` + `Message` + optional extra `@mentions`
   * **Send:** `category: "BIRTHDAY"`, `"PROMOTION"`, or `"MILESTONE"`, `targetUserId`, `mentionedUserIds`, `title`, `content`
   * **Notifications:** Tagged member gets a personal alert; rest of the org is notified to wish/congratulate them.
4. **💬 General Update**
   * **Fields:** `Message` + optional `Attachment` + optional `@mentions`
   * **Send:** `category: "GENERAL"`, `content`, optional `file` / `mentionedUserIds`
   * **Notifications:** Updates live feed over Socket.IO without blasting push notifications to the whole org (only `@mentioned` users are notified).

---

## 3. Post Categories (`OrgPostCategory`)

| Category | Who Can Create | Best Used For |
| :--- | :--- | :--- |
| `ANNOUNCEMENT` | `ORG_ADMIN` / `TEAM_HEAD` only | Company-wide news, policy updates, or team concerns |
| `FESTIVAL` | `ORG_ADMIN` / `TEAM_HEAD` only | Diwali, Holi, Christmas, Eid posters & wishes |
| `MILESTONE` | Any Org Member | Team achievements or member shoutouts (`targetTeamId` / `targetUserId`) |
| `PROMOTION` | Any Org Member *(+ Auto-posted)* | Role promotions (`targetUserId`) |
| `BIRTHDAY` | Any Org Member | Birthday wishes (`targetUserId`) |
| `WELCOME` | Any Org Member *(+ Auto-posted)* | Welcoming new hires (`targetUserId` / `targetTeamId`) |
| `NEW_TEAM` | Any Org Member *(+ Auto-posted)* | New team launch (`targetTeamId`) |
| `GENERAL` | Any Org Member *(default)* | Everyday org-wide updates & discussions |

> [!NOTE]
> **Auto-Generated Posts (`isSystemGenerated: true`):**
> The backend automatically posts to the feed (and emits live Socket.IO + notifications) when:
> 1. A **new member** accepts an org invite (`WELCOME`)
> 2. A **new team** is created (`NEW_TEAM`)
> 3. A member's role is **upgraded** (`PROMOTION`)
>
> System-generated posts have `isSystemGenerated: true` and **cannot be edited** (`403` on `PATCH`), though Admins/Team Heads can pin or delete them.

---

## 4. REST API Endpoints

### A. Get Organization Feed (Paginated & Filterable)
```http
GET /api/organizations/:id/feed
```

**Query Parameters (all optional):**
| Param | Type | Description |
| :--- | :--- | :--- |
| `category` | `OrgPostCategory` | Filter by category (e.g., `MILESTONE`, `FESTIVAL`, `BIRTHDAY`) |
| `teamId` | `UUID` | Filter posts targeting a specific team (`targetTeamId`) |
| `search` | `string` (max 100) | Case-insensitive search across `title` and `content` |
| `pinnedOnly` | `boolean` | Pass `true` to fetch pinned posts only |
| `cursor` | `UUID` | Post ID from previous page's `nextCursor` |
| `limit` | `number` (1–50, default `20`) | Page size |

**Ordering:** Pinned posts first (`isPinned DESC`), then newest (`createdAt DESC`).

**Response (`200 OK`):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Organization feed retrieved successfully",
  "data": {
    "posts": [
      {
        "id": "uuid",
        "organizationId": "uuid",
        "authorId": "uuid",
        "category": "MILESTONE",
        "title": "Backend Team Shipped SFU v2!",
        "content": "Huge shoutout to everyone on this release!",
        "fileUrl": "https://bucket.s3.region.amazonaws.com/uploads/org-feed/poster.png",
        "fileType": "image",
        "fileName": "poster.png",
        "fileSize": 245120,
        "targetUserId": null,
        "targetTeamId": "team-uuid",
        "mentionedUserIds": ["user-uuid-1"],
        "isPinned": true,
        "pinnedAt": "2026-11-12T10:00:00.000Z",
        "pinnedById": "admin-uuid",
        "isSystemGenerated": false,
        "isEdited": false,
        "editedAt": null,
        "createdAt": "2026-11-12T09:55:00.000Z",
        "updatedAt": "2026-11-12T10:00:00.000Z",
        "author": { "id": "uuid", "name": "Princy Mishra", "avatar": "https://..." },
        "targetUser": null,
        "pinnedBy": { "id": "uuid", "name": "Princy Mishra", "avatar": "https://..." },
        "targetTeam": { "id": "team-uuid", "name": "Backend Team" },
        "commentCount": 4,
        "reactions": [
          { "emoji": "🎉", "count": 12, "reactedByMe": true },
          { "emoji": "👏", "count": 7, "reactedByMe": false }
        ]
      }
    ],
    "nextCursor": "last-post-uuid-or-null",
    "hasNextPage": true
  }
}
```

---

### B. Create Feed Post (JSON or `multipart/form-data`)
```http
POST /api/organizations/:id/feed
```
*(Rate limit: 30 writes/minute per user)*

**Body Fields:**
| Field | Type | Rules |
| :--- | :--- | :--- |
| `category` | `OrgPostCategory` | Optional (default `GENERAL`). `ANNOUNCEMENT` & `FESTIVAL` require `ORG_ADMIN` / `TEAM_HEAD`. |
| `title` | `string` (max 160) | Optional headline. |
| `content` | `string` (max 10000) | Optional if a file upload or `fileUrl` is provided. |
| *File Upload* | Binary (`FormData`) | Images: `.jpg, .jpeg, .png, .gif, .webp, .heic` (max 10MB). Docs: `.pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .txt, .csv` (max 25MB). `.svg` & `.html` blocked. |
| `fileUrl` | `https://...` URL | Alternative pre-uploaded S3/Cloudinary HTTPS URL (max 2048 chars). |
| `fileType` | `'image' \| 'file' \| 'document'` | Optional metadata if passing `fileUrl`. |
| `fileName` | `string` (max 255) | Optional metadata if passing `fileUrl`. |
| `fileSize` | `number` | Optional bytes (1 – 26,214,400) if passing `fileUrl`. |
| `targetUserId` | `UUID` | Optional — celebrated member (must belong to this org). |
| `targetTeamId` | `UUID` | Optional — highlighted team (must belong to this org). |
| `mentionedUserIds` | `UUID[]` | Optional (max 25). In `FormData`, can be JSON-stringified `'["uuid1"]'` or comma-separated. |

**Response:** `201 Created` with the created `PostObject`.

---

### C. Get Single Post
```http
GET /api/organizations/:id/feed/:postId
```

### D. Edit Post *(Author only; not allowed for `isSystemGenerated`)*
```http
PATCH /api/organizations/:id/feed/:postId
```
* Accepts the same optional fields as `POST`.
* At least one body field must be sent in `req.body` (if replacing only the image via `FormData`, include `fileType: 'image'` or `content`).
* Sets `isEdited: true`, `editedAt`.

### E. Delete Post *(Author, `ORG_ADMIN`, or `TEAM_HEAD`)*
```http
DELETE /api/organizations/:id/feed/:postId
```
**Response (`200 OK`):** `{ deleted: true, postId }`

### F. Pin / Unpin Post *(`ORG_ADMIN` or `TEAM_HEAD` only)*
```http
POST /api/organizations/:id/feed/:postId/pin
```
* Toggles `isPinned` on/off. Max **5 pinned posts** per organization (`400` if limit reached).

### G. Toggle Emoji Reaction
```http
POST /api/organizations/:id/feed/:postId/react
```
*(Rate limit: 30 writes/minute per user)*  
**Body:** `{ "emoji": "🎉" }` (1–16 chars; `< > " ' / \` disallowed)  
**Response (`200 OK`):** `{ postId, emoji, action: "added" | "removed", reactions: [{ emoji, count, reactedByMe }] }`

### H. Get Comments & Threaded Replies
```http
GET /api/organizations/:id/feed/:postId/comments?cursor=<uuid>&limit=20
```
* Returns top-level comments (`createdAt ASC`) with nested `replies` array (`1` level deep) and `_count.replies`.

### I. Create Comment or Reply
```http
POST /api/organizations/:id/feed/:postId/comments
```
*(Rate limit: 30 writes/minute per user)*  
**Body:** `{ "content": "Happy Birthday!!", "parentId": "optional-parent-comment-uuid" }`  
*(Replying to a reply automatically flattens to the root parent comment so threads stay 1-level deep.)*

### J. Edit & Delete Comment
* `PATCH /api/organizations/:id/feed/:postId/comments/:commentId` *(Author only)* — Body: `{ "content": "..." }`
* `DELETE /api/organizations/:id/feed/:postId/comments/:commentId` *(Author, `ORG_ADMIN`, or `TEAM_HEAD`)* — Cascades replies if deleting a parent comment.

---

## 5. Real-Time Socket.IO Events

Join the organization room when opening an org screen, and leave on unmount:

```typescript
socket.emit('org:join', { organizationId: orgId }, (ack) => { ... });
socket.emit('org:leave', { organizationId: orgId });
```

| Event Name | Payload Shape | UI Action |
| :--- | :--- | :--- |
| `org:feed:post:new` | `{ organizationId, post }` | Prepend post below pinned posts (or top if pinned). |
| `org:feed:post:updated` | `{ organizationId, post }` | Update post in state (preserve local `reactedByMe` flags). |
| `org:feed:post:deleted` | `{ organizationId, postId }` | Remove post from list. |
| `org:feed:post:pinned` | `{ organizationId, post }` | Update `isPinned` and re-sort pinned posts first. |
| `org:feed:reaction:updated` | `{ organizationId, postId, actorId, emoji, action, reactions }` | Update post reaction counts (if `actorId !== currentUserId`, preserve local `reactedByMe`). |
| `org:feed:comment:new` | `{ organizationId, postId, comment }` | Increment `commentCount`; append to top-level comments (`parentId === null`) or `replies` under `comment.parentId`. |
| `org:feed:comment:updated` | `{ organizationId, postId, comment }` | Update comment/reply text & `isEdited`. |
| `org:feed:comment:deleted` | `{ organizationId, postId, commentId, parentId }` | Remove comment/reply & decrement `commentCount`. |

---

## 6. Notifications (`notification:new`)

* **`ORG_FEED_POST`** — Two-tier personalized copy:
  * Honored team (`targetTeamId`) or member (`targetUserId`) gets a personal notification; the rest of the org gets an org-wide shoutout/announcement.
  * `data`: `{ organizationId, postId, category, audience: "target_user" | "target_team" | "mentioned" | "organization", targetTeamId, targetUserId }`
* **`ORG_FEED_COMMENT`** — Sent to post author (comments) & parent comment author (replies).
  * `data`: `{ organizationId, postId, commentId }`

---

## 7. Bookmarking (`SavedItem`)

Save any org post to Saved Items / Collections using `itemType: "ORG_POST"`:
```http
POST /api/saved-items
{ "itemType": "ORG_POST", "itemId": "<postId>", "note": "optional", "collectionId": "optional" }
```

---

## 8. Common Error Status Codes

| Code | Meaning |
| :--- | :--- |
| `400` | Validation error, invalid UUID/cursor, blocked file (`.svg`/`.html`), max 5 pinned posts reached, or `targetUserId`/`targetTeamId` not in this org. |
| `401` | Missing/expired auth token. |
| `403` | Not an org member, regular `MEMBER` trying to post `ANNOUNCEMENT`/`FESTIVAL` or pin, editing another user's post/comment, or editing a system-generated post. |
| `404` | Post or comment not found in this org. |
| `429` | Rate limit exceeded (>30 feed write actions in 1 minute). |
