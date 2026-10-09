# Real-Time Chat & Direct Messaging API Integration Guide

This guide covers everything required to integrate the Chat & Direct Messaging features in the Quorum frontend (Web & Mobile).

---

## 1. Socket.IO Connection & Authentication

### Connection Setup
Connect to the Socket.IO server passing the JWT Access Token in `auth.token` or the `Authorization` header:

```javascript
import { io } from "socket.io-client";

const socket = io("https://api.newquorum.me", {
  auth: {
    token: accessToken // e.g. from user session or login
  },
  transports: ["websocket", "polling"],
  withCredentials: true
});

socket.on("connect", () => {
  console.log("Connected to Quorum socket server:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("Socket connection error:", err.message);
});
```

---

## 2. Socket.IO Events Reference

### A. Client → Server Events

#### 1. `conversation:join`
Join a specific conversation's real-time room to receive active typing and message events.
* **Payload:**
  ```json
  {
    "conversationId": "c4b9d031-18e4-4d45-933e-b490f2302821"
  }
  ```
* **Acknowledgement Callback:**
  ```json
  { "success": true }
  ```

#### 2. `conversation:leave`
Leave a conversation room when navigating away from the chat screen.
* **Payload:**
  ```json
  {
    "conversationId": "c4b9d031-18e4-4d45-933e-b490f2302821"
  }
  ```
* **Acknowledgement Callback:**
  ```json
  { "success": true }
  ```

#### 3. `message:send`
Send a new text or media message in a conversation. Supports optimistic UI via `clientMessageId`.
* **Payload:**
  ```json
  {
    "conversationId": "c4b9d031-18e4-4d45-933e-b490f2302821",
    "clientMessageId": "temp-uuid-12345",
    "content": "Hello world!",
    "fileUrl": "https://res.cloudinary.com/quorum/image/upload/sample.jpg",
    "fileType": "image"
  }
  ```
* **Acknowledgement Callback:**
  ```json
  {
    "success": true,
    "data": {
      "id": "msg-9f20e4b8-2e0f-4df4-a829-d591b9204391",
      "conversationId": "c4b9d031-18e4-4d45-933e-b490f2302821",
      "senderId": "user-uuid-123",
      "content": "Hello world!",
      "fileUrl": "https://res.cloudinary.com/quorum/image/upload/sample.jpg",
      "fileType": "image",
      "seq": 42,
      "createdAt": "2026-10-09T18:00:00.000Z",
      "sender": {
        "id": "user-uuid-123",
        "name": "Jane Doe",
        "avatar": "https://res.cloudinary.com/..."
      }
    }
  }
  ```

#### 4. `message:read`
Mark a specific message as read. Advances the user's read boundary up to that message sequence number.
* **Payload:**
  ```json
  {
    "conversationId": "c4b9d031-18e4-4d45-933e-b490f2302821",
    "messageId": "msg-9f20e4b8-2e0f-4df4-a829-d591b9204391"
  }
  ```
* **Acknowledgement Callback:**
  ```json
  {
    "success": true,
    "data": {
      "conversationId": "c4b9d031-18e4-4d45-933e-b490f2302821",
      "userId": "reader-user-uuid",
      "lastReadSeq": 42,
      "lastReadMessageId": "msg-9f20e4b8-2e0f-4df4-a829-d591b9204391",
      "updated": true
    }
  }
  ```

#### 5. `typing:start` & `typing:stop`
Notify participants that the current user started or stopped typing. (Debounce on keypress and stop after 1.5–2s of inactivity).
* **Payload:**
  ```json
  {
    "conversationId": "c4b9d031-18e4-4d45-933e-b490f2302821"
  }
  ```

---

### B. Server → Client Broadcast Events

#### 1. `message:new`
Broadcasted to the conversation room when a new message is posted.
* **Payload:**
  ```json
  {
    "id": "msg-uuid",
    "conversationId": "conv-uuid",
    "senderId": "user-uuid",
    "content": "Hello!",
    "fileUrl": null,
    "fileType": null,
    "seq": 43,
    "createdAt": "2026-10-09T18:01:00.000Z",
    "sender": {
      "id": "user-uuid",
      "name": "Alex Smith",
      "avatar": "https://..."
    }
  }
  ```

#### 2. `conversation:update`
Broadcasted to participants' user channels (`user:${userId}`) to update the conversation inbox preview (last message and unread count) in real time.
* **Payload:**
  ```json
  {
    "conversationId": "conv-uuid",
    "lastMessage": {
      "id": "msg-uuid",
      "content": "Hello!",
      "createdAt": "2026-10-09T18:01:00.000Z",
      "sender": { "id": "user-uuid", "name": "Alex Smith" }
    }
  }
  ```

#### 3. `message:read`
Broadcasted to the conversation when another participant reads messages.
* **Payload:**
  ```json
  {
    "conversationId": "conv-uuid",
    "userId": "reader-user-uuid",
    "lastReadSeq": 43,
    "lastReadMessageId": "msg-uuid",
    "messageId": "msg-uuid"
  }
  ```

#### 4. `typing:start` & `typing:stop`
Broadcasted when another participant starts or stops typing.
* **Payload:**
  ```json
  {
    "conversationId": "conv-uuid",
    "userId": "typing-user-uuid"
  }
  ```

#### 5. `presence:online` & `presence:offline`
Broadcasted to contacts/co-participants when a user connects or disconnects.
* **Online Payload:** `{ "userId": "user-uuid" }`
* **Offline Payload:** `{ "userId": "user-uuid", "lastSeen": "2026-10-09T18:05:00.000Z" }`

---

## 3. REST API Endpoints

All endpoints require `Authorization: Bearer <ACCESS_TOKEN>`. For web clients using session cookies, include `x-xsrf-token` header if modifying data.

### 1. Start or Get Direct Conversation (1:1)
* **Endpoint:** `POST /api/dm`
* **Body:**
  ```json
  {
    "targetUserId": "user-uuid-to-chat-with"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "conv-uuid",
      "type": "direct",
      "directKey": "userA_userB",
      "participants": [
        {
          "userId": "user-uuid-1",
          "user": { "id": "user-uuid-1", "name": "User 1", "avatar": "..." }
        },
        {
          "userId": "user-uuid-2",
          "user": { "id": "user-uuid-2", "name": "User 2", "avatar": "..." }
        }
      ]
    }
  }
  ```

### 2. Create Group Conversation
Create a new group chat with a name, optional avatar, and initial members.
* **Endpoint:** `POST /api/conversations/group`
* **Body:**
  ```json
  {
    "name": "Project Engineering",
    "avatar": "https://res.cloudinary.com/...",
    "participantIds": [
      "user-uuid-1",
      "user-uuid-2"
    ]
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "conv-uuid-group",
      "type": "group",
      "name": "Project Engineering",
      "avatar": "https://res.cloudinary.com/...",
      "participants": [
        { "userId": "creator-uuid", "user": { "id": "creator-uuid", "name": "Creator" } },
        { "userId": "user-uuid-1", "user": { "id": "user-uuid-1", "name": "User 1" } },
        { "userId": "user-uuid-2", "user": { "id": "user-uuid-2", "name": "User 2" } }
      ]
    }
  }
  ```

### 3. Add Members to Group
Add one or more users to an existing group.
* **Endpoint:** `POST /api/conversations/:id/participants`
* **Body:**
  ```json
  {
    "participantIds": [
      "user-uuid-3",
      "user-uuid-4"
    ]
  }
  ```
* **Response (200 OK):** Returns updated group conversation with all participants.

### 4. Remove Member or Leave Group
Leave a group (pass own `userId`) or remove another member.
* **Endpoint:** `DELETE /api/conversations/:id/participants/:userId`
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "success": true,
      "conversationDeleted": false
    }
  }
  ```

### 5. Update Group Name / Avatar
* **Endpoint:** `PATCH /api/conversations/:id`
* **Body:**
  ```json
  {
    "name": "Updated Group Title",
    "avatar": "https://res.cloudinary.com/..."
  }
  ```
* **Response (200 OK):** Returns updated group conversation.

### 6. List User Conversations
* **Endpoint:** `GET /api/conversations`
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "conv-uuid",
        "type": "direct",
        "unreadCount": 2,
        "lastMessage": {
          "id": "msg-uuid",
          "content": "Hey, let's connect!",
          "createdAt": "2026-10-09T17:50:00.000Z",
          "sender": { "id": "sender-uuid", "name": "Alex" }
        },
        "participants": [ ... ]
      }
    ]
  }
  ```

### 7. Fetch Paginated Messages (Cursor-based)
* **Endpoint:** `GET /api/conversations/:id/messages`
* **Query Parameters:**
  - `cursor`: (Optional) ID of the oldest message currently displayed.
  - `limit`: (Optional, default `20`, max `50`) Number of messages per page.
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "messages": [ ... ],
      "nextCursor": "msg-uuid-oldest-in-this-page",
      "hasNextPage": true
    }
  }
  ```

### 8. Search Users (to Start a Chat)
* **Endpoint:** `GET /api/users/search` (or `GET /api/user/search`)
* **Query Parameters:**
  - `q`: Name or email query (string)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "user-uuid-1",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "avatar": "https://res.cloudinary.com/..."
      }
    ]
  }
  ```

### 9. Search Conversation Messages
* **Endpoint:** `GET /api/conversations/:id/search`
* **Query Parameters:**
  - `q`: Search keyword (string)
  - `cursor`: (Optional) Message ID cursor for pagination
  - `limit`: (Optional, default `20`)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "messages": [ ... ],
      "nextCursor": "msg-uuid-next",
      "hasNextPage": false
    }
  }
  ```

### 10. Media Uploads (Cloudinary Signature)
* **Endpoint:** `POST /api/uploads/sign`
* **Body:**
  ```json
  {
    "folder": "chat_attachments"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "uploadUrl": "https://api.cloudinary.com/v1_1/your-cloud-name/auto/upload",
      "timestamp": 1791374400,
      "signature": "3f6a2b...",
      "apiKey": "1234567890",
      "folder": "quorum_uploads/chat_attachments"
    }
  }
  ```
* **Upload Flow:**
  1. Call `POST /api/uploads/sign` to get signature, timestamp, and upload URL.
  2. Directly upload the binary file from frontend to Cloudinary using `multipart/form-data`.
  3. Send the resulting `secure_url` in `fileUrl` via `message:send`.

### 11. FCM Push Device Tokens
* **Register Device:** `POST /api/devices`
  ```json
  {
    "token": "fcm_device_token_from_firebase",
    "platform": "android"
  }
  ```
* **Unregister Device (on Logout):** `DELETE /api/devices`
  ```json
  {
    "token": "fcm_device_token_from_firebase"
  }
  ```

---

## 4. Socket Error Codes

When a socket acknowledgement returns `{ "success": false }`, the `code` property indicates the cause:

| Error Code | Meaning | Recommended Frontend Action |
|---|---|---|
| `UNAUTHORIZED` | Token missing, invalid, or expired | Prompt re-login or refresh access token |
| `NOT_PARTICIPANT` | User is not a member of the conversation | Prevent access to this conversation |
| `RATE_LIMITED` | Message or typing limit exceeded | Display a temporary cooldown alert |
| `INVALID_PAYLOAD` | Content or payload validation failed | Check payload formatting and attachment URLs |
| `SERVER_ERROR` | Internal server exception | Retry with exponential backoff |
