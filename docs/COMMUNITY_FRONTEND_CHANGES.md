# 📢 Community Feature — Frontend Integration Guide

This document outlines all recent changes and enhancements made to the **Community Feature** in the backend, including **REST API endpoints**, **Channel structures**, and **Real-Time WebSockets (Live Posts & Comments without Page Refresh)**.

---

## 📑 Table of Contents
1. [Overview of Key Updates](#1-overview-of-key-updates)
2. [Real-Time WebSocket Events (Live Feed & Comments)](#2-real-time-websocket-events-live-feed--comments)
   - [Room Join / Leave Conventions](#21-room-join--leave-conventions)
   - [Live Post Events](#22-live-post-events)
   - [Live Comment Events](#23-live-comment-events)
3. [Community Channels (REST API)](#3-community-channels-rest-api)
   - [List Channels in Community](#31-list-channels)
   - [Create New Channel](#32-create-channel)
   - [Update Channel](#33-update-channel)
   - [Delete Channel](#34-delete-channel)
4. [Channel-Scoped Posts & Feed (REST API)](#4-channel-scoped-posts--feed-rest-api)
   - [Create Post in Channel](#41-create-post-in-channel)
   - [Get Posts in Channel](#42-get-posts-in-channel)
   - [Update / Delete Post](#43-update--delete-post)
5. [Comments on Posts (REST API)](#5-comments-on-posts-rest-api)
   - [Add Comment](#51-add-comment)
   - [Delete Comment](#52-delete-comment)
6. [Supported File Types in Posts](#6-supported-file-types-in-posts)
7. [Community Invitations Flow](#7-community-invitations-flow)

---

## 1. Overview of Key Updates

1. **No Refresh Needed**: All community posts, edits, deletions, and comments are broadcasted via WebSockets in real time.
2. **Channel-Based Architecture**: Communities now feature Discord/Slack-style channels (with a default `# general` channel automatically provisioned).
3. **Document File Attachments**: Added full support for documents (`pdf`, `doc`, `docx`, `txt`, etc.) alongside `image`, `video`, and `audio`.
4. **Targeted Invitations**: Send invitations to specific users with in-app accept/decline actions.

---

## 2. Real-Time WebSocket Events (Live Feed & Comments)

All real-time communication uses the existing Socket.IO connection.

### 2.1 Room Join / Leave Conventions

To receive live updates for a community, channel, or post thread, the frontend emits these events upon entering and leaving the respective views:

```typescript
// 1. When opening a Community view:
socket.emit('community:join', { communityId: 'COMMUNITY_UUID' }, (ack) => {
  if (ack.success) console.log('Listening for community updates');
});
// When leaving the Community view:
socket.emit('community:leave', { communityId: 'COMMUNITY_UUID' });

// 2. When opening a specific Channel tab:
socket.emit('community:channel:join', { channelId: 'CHANNEL_UUID' });
// When leaving the Channel:
socket.emit('community:channel:leave', { channelId: 'CHANNEL_UUID' });

// 3. When opening a Post modal / Comment thread:
socket.emit('community:post:join', { postId: 'POST_UUID' });
// When closing the modal / leaving the post thread:
socket.emit('community:post:leave', { postId: 'POST_UUID' });
```

---

### 2.2 Live Post Events

#### A. New Post (`community:post:new`)
Emitted whenever any member submits a post in the community or channel.

```typescript
socket.on('community:post:new', ({ post }) => {
  // If the user is viewing the matching channel or community feed:
  setPosts((prev) => {
    // Prevent duplicate if current user authored the post
    if (prev.some((p) => p.id === post.id)) return prev;
    return [post, ...prev]; // Prepend new post
  });
});
```

**Payload Example:**
```json
{
  "post": {
    "id": "e8620e7e-3965-4f40-84cf-342ff15291b7",
    "communityId": "a1b2c3d4-...",
    "channelId": "c5d6e7f8-...",
    "content": "Check out our latest project milestone!",
    "fileUrl": "https://s3.amazonaws.com/quorumuploads/...",
    "fileType": "image",
    "createdAt": "2026-10-23T12:00:00.000Z",
    "author": {
      "id": "u123",
      "name": "Jane Doe",
      "avatar": "https://..."
    },
    "channel": {
      "id": "c5d6e7f8-...",
      "name": "general",
      "isDefault": true
    },
    "_count": {
      "comments": 0
    }
  }
}
```

#### B. Post Updated (`community:post:updated`)
Emitted when an author or admin edits a post.

```typescript
socket.on('community:post:updated', ({ post }) => {
  setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, ...post } : p)));
});
```

#### C. Post Deleted (`community:post:deleted`)
Emitted when a post is removed.

```typescript
socket.on('community:post:deleted', ({ postId, channelId, communityId }) => {
  setPosts((prev) => prev.filter((p) => p.id !== postId));
});
```

---

### 2.3 Live Comment Events

#### A. New Comment (`community:comment:new`)
Emitted to both the post room (`community:post:{postId}`) and the community room (`community:{communityId}`).

```typescript
socket.on('community:comment:new', ({ comment, postId, communityId }) => {
  // 1. If currently viewing this post's comment thread:
  if (activePostId === postId) {
    setComments((prev) => {
      if (prev.some((c) => c.id === comment.id)) return prev;
      return [...prev, comment];
    });
  }

  // 2. Increment comment count badge on feed card:
  setPosts((prev) =>
    prev.map((p) =>
      p.id === postId
        ? { ...p, _count: { ...p._count, comments: (p._count?.comments || 0) + 1 } }
        : p
    )
  );
});
```

**Payload Example:**
```json
{
  "postId": "e8620e7e-3965-4f40-84cf-342ff15291b7",
  "communityId": "a1b2c3d4-...",
  "comment": {
    "id": "b73a5a73-9824-4f43-a602-581335cb8c1e",
    "postId": "e8620e7e-3965-4f40-84cf-342ff15291b7",
    "content": "Great progress, congratulations!",
    "createdAt": "2026-10-23T12:02:00.000Z",
    "author": {
      "id": "u456",
      "name": "Alex Smith",
      "avatar": "https://..."
    }
  }
}
```

#### B. Comment Deleted (`community:comment:deleted`)
Emitted when a comment is deleted.

```typescript
socket.on('community:comment:deleted', ({ commentId, postId, communityId }) => {
  // 1. Remove comment from open thread
  if (activePostId === postId) {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }

  // 2. Decrement comment count badge on feed card
  setPosts((prev) =>
    prev.map((p) =>
      p.id === postId
        ? {
            ...p,
            _count: {
              ...p._count,
              comments: Math.max((p._count?.comments || 1) - 1, 0)
            }
          }
        : p
    )
  );
});
```

---

## 3. Community Channels (REST API)

Communities now support multiple channels. A default `# general` (`isDefault: true`) channel is created automatically for every community.

### 3.1 List Channels
- **`GET /api/v1/communities/:communityId/channels`**
- **Auth**: Bearer Token (Community member)
- **Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "c5d6e7f8-...",
      "communityId": "a1b2c3d4-...",
      "name": "general",
      "description": "General discussions for all members",
      "isDefault": true,
      "createdAt": "2026-10-20T10:00:00.000Z"
    },
    {
      "id": "d7e8f9a0-...",
      "communityId": "a1b2c3d4-...",
      "name": "announcements",
      "description": "Important updates",
      "isDefault": false,
      "createdAt": "2026-10-21T11:00:00.000Z"
    }
  ]
}
```

### 3.2 Create Channel
- **`POST /api/v1/communities/:communityId/channels`**
- **Auth**: Admin or Owner
- **Body**:
```json
{
  "name": "development",
  "description": "Tech discussions"
}
```
*(Channel names are lowercased and must be unique per community).*

### 3.3 Update Channel
- **`PATCH /api/v1/communities/:communityId/channels/:channelId`**
- **Auth**: Admin or Owner
- **Body**:
```json
{
  "name": "dev-chat",
  "description": "Engineering team chat"
}
```

### 3.4 Delete Channel
- **`DELETE /api/v1/communities/:communityId/channels/:channelId`**
- **Auth**: Admin or Owner
- *(Note: Default `general` channel cannot be deleted).*

---

## 4. Channel-Scoped Posts & Feed (REST API)

### 4.1 Create Post in Channel
- **`POST /api/v1/communities/:communityId/channels/:channelId/posts`**
- **Auth**: Bearer Token (Community member)
- **Body**:
```json
{
  "content": "Here is the architectural document for review.",
  "fileUrl": "https://s3.amazonaws.com/...", // optional
  "fileType": "document" // optional: "image" | "video" | "audio" | "document"
}
```

### 4.2 Get Posts in Channel
- **`GET /api/v1/communities/:communityId/channels/:channelId/posts?page=1&limit=20`**
- **Auth**: Bearer Token (Community member)
- Returns paginated posts belonging specifically to that channel, including author details and comment counts.

### 4.3 Update / Delete Post
- **Update**: `PATCH /api/v1/posts/:postId` (Author or Admin)
  - Body: `{ "content": "Updated content...", "fileUrl": "...", "fileType": "document" }`
- **Delete**: `DELETE /api/v1/posts/:postId` (Author or Admin)

---

## 5. Comments on Posts (REST API)

### 5.1 Add Comment
- **`POST /api/v1/posts/:postId/comments`**
- **Auth**: Bearer Token (Community member)
- **Body**:
```json
{
  "content": "This is a great idea!"
}
```

### 5.2 Delete Comment
- **`DELETE /api/v1/comments/:commentId`**
- **Auth**: Author or Admin

---

## 6. Supported File Types in Posts

When attaching files via Amazon S3 presigned URLs, the `fileType` field supports:
- `"image"` — jpg, png, webp, gif, etc.
- `"video"` — mp4, webm, mov, etc.
- `"audio"` — mp3, wav, aac, etc.
- `"document"` — pdf, doc, docx, xls, xlsx, ppt, pptx, txt, zip, etc.

---

## 7. Community Invitations Flow

1. **Create Invite**: `POST /api/v1/communities/:communityId/invites`
   - General link invite: `{ "expiresInHours": 48 }`
   - Targeted user invite: `{ "invitedUserId": "USER_UUID" }`
2. **Accept Targeted Invite**: `POST /api/v1/communities/invites/:inviteId/accept`
3. **Decline Targeted Invite**: `POST /api/v1/communities/invites/:inviteId/decline`
4. **Accept General Code**: `POST /api/v1/communities/join/:inviteCode`
