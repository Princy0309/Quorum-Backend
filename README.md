# Quorum Backend

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-lightgrey.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.x-darkblue.svg)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-7+-red.svg)](https://redis.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-5.x-red.svg)](https://bullmq.io/)
[![WebRTC Werift](https://img.shields.io/badge/WebRTC-Werift%20SFU-orange.svg)](https://github.com/shinyishi/werift-webrtc)
[![Swagger](https://img.shields.io/badge/OpenAPI-3.0-brightgreen.svg)](https://swagger.io/)

Quorum is an enterprise-grade real-time collaboration and workspace platform. It unites team chat, multi-tenant organizations, scoped teams, community forums with channels, collaborative calendars, AI-assisted productivity, and high-capacity WebRTC multi-party video conferencing backed by a custom Selective Forwarding Unit (SFU).

---

## Table of Contents

1. [Interactive Swagger API Documentation](#interactive-swagger-api-documentation)
2. [Key Platform Features](#key-platform-features)
3. [Architecture & Technology Stack](#architecture--technology-stack)
4. [Prerequisites & Getting Started](#prerequisites--getting-started)
5. [Environment Variables Reference](#environment-variables-reference)
6. [Complete REST API Catalog](#complete-rest-api-catalog)
   - [Health & Security](#1-health--security)
   - [Authentication & Sessions](#2-authentication--sessions)
   - [OTP & Email Verification](#3-otp--email-verification)
   - [User Management](#4-user-management)
   - [Direct & Group Conversations (Chat)](#5-direct--group-conversations-chat)
   - [Communities, Channels & Invites](#6-communities-channels--invites)
   - [Community Posts & Comments](#7-community-posts--comments)
   - [Organizations, Teams & Tasks](#8-organizations-teams--tasks)
   - [Calendar & Events](#9-calendar--events)
   - [Meetings & SFU Video Calling](#10-meetings--sfu-video-calling)
   - [Media & S3 File Storage](#11-media--s3-file-storage)
   - [Notifications & Device Tokens](#12-notifications--device-tokens)
   - [AI Workplace Assistant](#13-ai-workplace-assistant)
   - [Personal Saved Items & Collections](#14-personal-saved-items--collections)
7. [Real-Time WebSocket Architecture](#real-time-websocket-architecture)
8. [WebRTC / SFU Video Architecture](#webrtc--sfu-video-architecture)
9. [Background Queues & Workers](#background-queues--workers)
10. [Testing & Production Deployment](#testing--production-deployment)

---

## Interactive Swagger API Documentation

Quorum Backend includes a fully interactive OpenAPI 3.0 specification mounted via Swagger UI:

- **Swagger UI Interactive Console:** `http://localhost:5000/api-docs` (or `/api-docs` on your deployed server)
- **OpenAPI 3.0 JSON Document:** `http://localhost:5000/api-docs.json` or `/api-docs/swagger.json`

### Authentication in Swagger UI
1. Click **Authorize** (top right) in Swagger UI.
2. Enter your JWT token under `BearerAuth`: `Bearer <your_access_token>`.
3. Fetch a CSRF token from `GET /api/csrf-token` and enter it under `CSRFAuth` (`x-xsrf-token`).

---

## Key Platform Features

- **Multi-Tenant Organizations & RBAC:** Hierarchical multi-tenancy with Role-Based Access Control (`ORG_ADMIN`, `TEAM_HEAD`, `MEMBER`), scoped teams, member management, tokenized join links, and team task tracking.
- **Communities & Thematic Channels:** Public and private spaces, customizable discussion channels (`#announcements`, `#dev`), threaded discussions, media attachments, and real-time live feed updates.
- **Real-Time Direct & Group Messaging:** 1-on-1 direct messaging, multi-user group chats, @user mentions with push notifications, read receipts, typing indicators, and message search.
- **Selective Forwarding Unit (SFU) Video Calling:** Multi-party audio/video conferencing built with [Werift](https://github.com/shinyishi/werift-webrtc). Uses native RTP packet forwarding with authentic DTLS-SRTP encryption, RTCP PLI keyframe generation, and dynamic UDP port allocation (40000–40100).
- **Intelligent Workspace AI (Google Gemini):** Grounded workspace assistance, intelligent conversation and meeting transcript summarization, contextual quick replies, and interaction history tracking.
- **Calendar & Scheduled Reminders:** Collaborative event management (Reminders, Meetings, Deadlines, General) integrated with BullMQ background delayed jobs for automatic email delivery.
- **Enterprise Media Uploads:** Direct-to-S3 presigned URLs protected by a dual-tier rate limiting system (burst limiter: 10 req/min, daily quota: 100 uploads/24h).
- **Multi-Channel Notifications:** In-app real-time notification streaming via WebSockets, email digests, and Firebase Cloud Messaging (FCM) mobile push alerts.
- **Personal Bookmarks & Collections:** Saved items subsystem allowing users to organize messages, posts, external links, and files into color-coded collections.

---

## Architecture & Technology Stack

| Layer | Technologies | Purpose |
| :--- | :--- | :--- |
| **Runtime & Language** | Node.js 20+, TypeScript 5.x | High-throughput async I/O, static type safety |
| **Web Framework** | Express.js 4.x, CORS, Helmet, CSRF protection | REST API routing, security middleware, validation |
| **Database & ORM** | PostgreSQL 15+, Prisma ORM 5.x | Relational storage with multi-file modular schemas |
| **In-Memory Cache** | Redis 7+ (`ioredis`) | Session revocation, OTP tracking, presence, burst rate limits |
| **Background Queues** | BullMQ 5.x | Asynchronous email dispatch, digests, scheduled calendar reminders |
| **Real-Time Gateway** | Socket.IO 4.x | Bi-directional WebSocket events for chat, presence, SFU signaling |
| **Media / SFU Engine** | Werift WebRTC SFU | Low-latency multi-party audio/video forwarding (UDP 40000–40100) |
| **Cloud Storage** | AWS S3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) | Presigned secure file uploads and asset storage |
| **Push Notifications** | Firebase Admin SDK (FCM) | Cross-platform mobile & web push notifications |
| **Workplace AI** | Google Gemini (`@google/genai`) | Contextual workplace intelligence, conversation summarization |
| **API Documentation** | Swagger UI (`swagger-ui-express`, OpenAPI 3.0) | Interactive API exploration and client generation |
| **Observability** | Winston 3.x | Structured JSON logging with daily file rotation and log levels |

---

## Prerequisites & Getting Started

### Prerequisites
- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **PostgreSQL** >= 15.0
- **Redis** >= 7.0
- **AWS S3 Bucket** (for media uploads)
- **SMTP Server** (Gmail, SendGrid, Amazon SES, or Mailgun)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/tusharTalan1/Quorum-Backend.git
   cd Quorum-Backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your database, redis, AWS, and SMTP credentials
   ```

4. **Run Prisma Migrations:**
   ```bash
   npm run db:migrate
   # (Optional) Generate Prisma Client:
   npm run db:generate
   ```

5. **Start Development Server:**
   ```bash
   npm run dev
   ```

6. **Verify Server Health:**
   ```bash
   curl http://localhost:5000/health
   ```
   Open `http://localhost:5000/api-docs` in your browser to view the interactive Swagger documentation.

---

## Environment Variables Reference

Create a `.env` file in the project root:

```env
# Server
PORT=5000
NODE_ENV=development
API_BASE_URL="http://localhost:5000"
CLIENT_URL="http://localhost:3000"
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173"
TRUST_PROXY=1

# Database (PostgreSQL)
DATABASE_URL="postgresql://user:password@localhost:5432/quorum?schema=public"

# Cache & Queues (Redis)
REDIS_URL="redis://localhost:6379"

# Security & Tokens
JWT_SECRET="your-super-secret-jwt-key-min-32-chars"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
COOKIE_SECRET="your-cookie-signing-secret"

# Email Configuration (SMTP)
SMTP_HOST="smtp.example.com"
SMTP_PORT=587
SMTP_USER="your-email@example.com"
SMTP_PASS="your-email-password"
EMAIL_FROM="Quorum <noreply@example.com>"

# AWS S3 Storage
AWS_REGION="your-aws-region"
AWS_ACCESS_KEY_ID="your-aws-access-key-id"
AWS_SECRET_ACCESS_KEY="your-aws-secret-access-key"
AWS_S3_BUCKET="your-s3-bucket-name"

# Google Gemini AI
GEMINI_API_KEY="your-gemini-api-key"

# Firebase Cloud Messaging (Push Notifications)
FIREBASE_SERVICE_ACCOUNT_PATH="./config/firebase-service-account.json"

# WebRTC SFU Configuration
ANNOUNCED_IP="127.0.0.1"
RTC_MIN_PORT=40000
RTC_MAX_PORT=40100
STUN_SERVER="stun:stun.l.google.com:19302"
```

---

## Complete REST API Catalog

The server exposes standard REST APIs under `/api/*` (with `/api/v1/*` aliases for future-proofing). All state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require the `x-xsrf-token` header retrieved from `/api/csrf-token`.

### 1. Health & Security

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | None | System health check (DB, Redis, Secrets readiness). |
| `GET` | `/api/csrf-token` | None | Returns CSRF token in cookie and response body. |

### 2. Authentication & Sessions

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | None | Register a new user account with email and password. |
| `POST` | `/api/auth/login` | None | Authenticate with credentials; returns access & refresh tokens. |
| `POST` | `/api/auth/refresh-token` | Refresh Token | Rotate refresh token and issue a fresh JWT access token. |
| `POST` | `/api/auth/logout` | Bearer JWT | Terminate current session and invalidate refresh token. |
| `POST` | `/api/auth/logout-all` | Bearer JWT | Invalidate all active sessions across all devices. |
| `GET` | `/api/auth/me` | Bearer JWT | Retrieve authenticated user profile and roles. |

### 3. OTP & Email Verification

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/otp/send-verification` | None | Dispatch an email verification OTP code. |
| `POST` | `/api/otp/verify-email` | None | Validate email OTP and mark account as verified. |
| `POST` | `/api/otp/forgot-password` | None | Request password reset OTP sent to registered email. |
| `POST` | `/api/otp/reset-password` | None | Reset user password using verified OTP token. |

### 4. User Management

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/users/search` | Bearer JWT | Global user directory search by name or email. |
| `GET` | `/api/users` | Bearer JWT | List users for direct messaging directory. |
| `GET` | `/api/users/:id` | Bearer JWT | Fetch public user profile and activity stats. |
| `PATCH` | `/api/users/profile` | Bearer JWT | Update user bio, display name, and preferences. |
| `PUT` | `/api/users/avatar` | Bearer JWT | Update user profile avatar image URL. |

### 5. Direct & Group Conversations (Chat)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/conversations` | Bearer JWT | List all direct and group conversations for the user. |
| `GET` | `/api/conversations/unread-count` | Bearer JWT | Get total unread message count across all conversations. |
| `POST` | `/api/conversations/direct` | Bearer JWT | Get or initialize a 1-on-1 direct conversation. |
| `POST` | `/api/conversations/group` | Bearer JWT | Create a new multi-participant group chat. |
| `GET` | `/api/conversations/:id` | Bearer JWT | Get conversation metadata and participant list. |
| `GET` | `/api/conversations/:id/messages` | Bearer JWT | Fetch paginated chat history with mentions & media. |
| `POST` | `/api/conversations/:id/messages` | Bearer JWT | Send a message (supports `@mentions`, attachments). |
| `PATCH` | `/api/conversations/:id/messages/:messageId` | Bearer JWT | Edit chat message content (Sender only). Broadcasts `message:updated`. |
| `DELETE` | `/api/conversations/:id/messages/:messageId` | Bearer JWT | Delete chat message (Sender or Group Admin). Broadcasts `message:deleted`. |
| `GET` | `/api/conversations/:id/search` | Bearer JWT | Full-text message search inside a conversation. |
| `POST` | `/api/conversations/:id/participants` | Bearer JWT | Add new participants to an existing group conversation. |
| `DELETE` | `/api/conversations/:id/participants/:userId` | Bearer JWT | Remove a member from the group conversation (Admins only). |
| `POST` | `/api/conversations/:id/admins/:userId` | Bearer JWT | Promote a participant to group administrator. |
| `DELETE` | `/api/conversations/:id/admins/:userId` | Bearer JWT | Demote a group administrator back to regular member. |
| `POST` | `/api/conversations/:id/leave` | Bearer JWT | Voluntarily leave a group conversation. |

### 6. Communities, Channels & Invites

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/communities` | Bearer JWT | Create a new community workspace. |
| `GET` | `/api/communities` | Bearer JWT | List communities the authenticated user is a member of. |
| `GET` | `/api/communities/feed` | Bearer JWT | Unified aggregate feed across all joined communities. |
| `GET` | `/api/communities/:id` | Bearer JWT | Get community metadata, rules, and member stats. |
| `PATCH` | `/api/communities/:id` | Bearer JWT | Update community title, description, or visibility (Admins). |
| `DELETE` | `/api/communities/:id` | Bearer JWT | Delete community (Owner only). |
| `POST` | `/api/communities/:id/leave` | Bearer JWT | Leave community (transfers ownership if sole owner). |
| `POST` | `/api/communities/:id/transfer-ownership` | Bearer JWT | Transfer community ownership to another member. |
| `GET` | `/api/communities/:id/members` | Bearer JWT | List members with roles (`OWNER`, `ADMIN`, `MODERATOR`, `MEMBER`). |
| `PATCH` | `/api/communities/:id/members/:userId/role` | Bearer JWT | Update a member's role (Requires `ADMIN` or `OWNER`). |
| `DELETE` | `/api/communities/:id/members/:userId` | Bearer JWT | Kick a member from the community. |
| `GET` | `/api/communities/:id/invitable-users` | Bearer JWT | Search eligible users to invite (excluding existing members). |
| `POST` | `/api/communities/:id/invites` | Bearer JWT | Send an invitation by `email` or `{ invitedUserId, expiresInHours }`. |
| `GET` | `/api/communities/:id/invites` | Bearer JWT | List active pending invitations for the community. |
| `DELETE` | `/api/communities/:id/invites/:inviteId` | Bearer JWT | Revoke a pending community invitation. |
| `GET` | `/api/communities/invitations/pending` | Bearer JWT | List all pending invitations received by the current user. |
| `GET` | `/api/communities/join/:token` | None | Public preview metadata for a community invitation link. |
| `POST` | `/api/communities/join/:token` | Bearer JWT | Accept invitation and join community via token. |
| `POST` | `/api/communities/invites/:token/accept` | Bearer JWT | Accept invitation endpoint alias. |
| `POST` | `/api/communities/invites/:token/decline` | Bearer JWT | Decline community invitation. |
| `GET` | `/api/communities/:id/channels` | Bearer JWT | List discussion channels within the community. |
| `POST` | `/api/communities/:id/channels` | Bearer JWT | Create a new channel (e.g. `#general`, `#dev`). |
| `GET` | `/api/communities/:id/channels/:channelId` | Bearer JWT | Get channel details. |
| `PATCH` | `/api/communities/:id/channels/:channelId` | Bearer JWT | Rename or update channel description. |
| `DELETE` | `/api/communities/:id/channels/:channelId` | Bearer JWT | Delete channel and associated posts. |
| `GET` | `/api/communities/:id/channels/:channelId/posts` | Bearer JWT | List paginated posts within a channel. |
| `POST` | `/api/communities/:id/channels/:channelId/posts` | Bearer JWT | Publish a new post into a designated channel. |

### 7. Community Posts & Comments

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/posts/feed` | Bearer JWT | Global community post feed. |
| `GET` | `/api/posts/:postId` | Bearer JWT | Retrieve single post with media attachments and author details. |
| `PATCH` | `/api/posts/:postId` | Bearer JWT | Edit post content (Author or Admin). |
| `DELETE` | `/api/posts/:postId` | Bearer JWT | Delete post (Author or Admin). |
| `POST` | `/api/posts/:postId/comments` | Bearer JWT | Add a comment to a post. |
| `GET` | `/api/posts/:postId/comments` | Bearer JWT | List threaded comments for a post. |
| `PATCH` | `/api/comments/:commentId` | Bearer JWT | Edit a comment. |
| `DELETE` | `/api/comments/:commentId` | Bearer JWT | Delete a comment. |

### 8. Organizations, Teams & Tasks

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/organizations` | Bearer JWT | Create an enterprise organization. |
| `GET` | `/api/organizations` | Bearer JWT | List organizations user belongs to. |
| `GET` | `/api/organizations/:id` | Bearer JWT | Get organization details and team hierarchy. |
| `PATCH` | `/api/organizations/:id` | Bearer JWT | Update organization settings (Requires `ORG_ADMIN`). |
| `POST` | `/api/organizations/:id/leave` | Bearer JWT | Leave an organization. |
| `GET` | `/api/organizations/:id/members` | Bearer JWT | List organization members and their roles. |
| `PATCH` | `/api/organizations/:id/members/:userId` | Bearer JWT | Update member role (`ORG_ADMIN`, `TEAM_HEAD`, `MEMBER`). |
| `DELETE` | `/api/organizations/:id/members/:userId` | Bearer JWT | Remove member from organization. |
| `POST` | `/api/organizations/:id/invites` | Bearer JWT | Create organization invite token. |
| `GET` | `/api/organizations/:id/invites` | Bearer JWT | List pending organization invites. |
| `DELETE` | `/api/organizations/:id/invites/:inviteId` | Bearer JWT | Revoke an organization invite. |
| `GET` | `/api/organizations/join/:token` | None | Preview organization invite metadata. |
| `POST` | `/api/organizations/join/:token` | Bearer JWT | Accept and join organization via invite token. |
| `POST` | `/api/organizations/:id/teams` | Bearer JWT | Create a new scoped team within organization. |
| `GET` | `/api/organizations/:id/teams` | Bearer JWT | List all teams in the organization. |
| `GET` | `/api/organizations/:id/teams/:teamId` | Bearer JWT | Get team metadata and member roster. |
| `PATCH` | `/api/organizations/:id/teams/:teamId` | Bearer JWT | Update team details. |
| `DELETE` | `/api/organizations/:id/teams/:teamId` | Bearer JWT | Delete a team. |
| `POST` | `/api/organizations/:id/teams/:teamId/members` | Bearer JWT | Add member to team. |
| `DELETE` | `/api/organizations/:id/teams/:teamId/members/:userId` | Bearer JWT | Remove member from team. |

### 9. Calendar & Events

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/calendar` | Bearer JWT | Create a calendar event (REMINDER, MEETING, DEADLINE, GENERAL) with BullMQ reminder scheduling. |
| `GET` | `/api/calendar/month` | Bearer JWT | Query events for a specific month (`year`, `month`). |
| `GET` | `/api/calendar/date` | Bearer JWT | Query events for a single day (`date=YYYY-MM-DD`). |
| `GET` | `/api/calendar/upcoming` | Bearer JWT | Fetch chronologically sorted upcoming events. |
| `GET` | `/api/calendar/:id` | Bearer JWT | Get event details by ID. |
| `PATCH` | `/api/calendar/:id` | Bearer JWT | Update event details and dynamically reschedule BullMQ reminders. |
| `DELETE` | `/api/calendar/:id` | Bearer JWT | Delete event and cancel its pending background reminder job. |

### 10. Meetings & SFU Video Calling

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/meetings` | Bearer JWT | Create a new video meeting session with a unique call code. |
| `GET` | `/api/meetings/:code` | Bearer JWT | Retrieve active meeting state, participant count, and metadata. |
| `POST` | `/api/meetings/:code/end` | Bearer JWT | Terminate meeting session and disconnect SFU peer connections. |

### 11. Media & S3 File Storage

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/uploads/sign` | Bearer JWT | Generate AWS S3 presigned PUT URL with mime-type validation. Rate limited to 10 req/min (burst) and 100 uploads/24h (quota). |
| `POST` | `/api/uploads/s3` | Bearer JWT | Direct multipart file upload endpoint to S3 with rate limit enforcement. |

### 12. Notifications & Device Tokens

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/notifications` | Bearer JWT | Get paginated notifications (`page`, `limit`, `unreadOnly`). |
| `GET` | `/api/notifications/unread-count` | Bearer JWT | Get total unread notifications count for badge indicators. |
| `PATCH` | `/api/notifications/read-all` | Bearer JWT | Mark all notifications as read. |
| `PATCH` | `/api/notifications/:id/read` | Bearer JWT | Mark specific notification as read. |
| `DELETE` | `/api/notifications/:id` | Bearer JWT | Delete a notification. |
| `GET` | `/api/notifications/preferences` | Bearer JWT | Get notification channel preferences (email, in-app, push). |
| `PUT` | `/api/notifications/preferences` | Bearer JWT | Update notification preferences. |
| `POST` | `/api/devices` | Bearer JWT | Register device token for Firebase Cloud Messaging (FCM). |
| `DELETE` | `/api/devices` | Bearer JWT | Unregister device token on logout. |

### 13. AI Workplace Assistant

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/ai/chat` | Bearer JWT | Interactive streaming/non-streaming chat with Gemini AI. |
| `POST` | `/api/ai/summarize` | Bearer JWT | Generate concise summaries of workspace content. |
| `POST` | `/api/ai/chat/:conversationId/summary` | Bearer JWT | Summarize chat transcript into key takeaways and action items. |
| `POST` | `/api/ai/search` | Bearer JWT | Semantic search across workspace messages and documents. |
| `POST` | `/api/ai/assist` | Bearer JWT | Context-aware writing and productivity assistance. |
| `POST` | `/api/ai/quick-replies` | Bearer JWT | Generate smart contextual replies for messages. |
| `POST` | `/api/ai/project-update` | Bearer JWT | Generate project status updates based on recent activity. |
| `GET` | `/api/ai/history` | Bearer JWT | Fetch conversation history with the AI assistant. |
| `DELETE` | `/api/ai/history` | Bearer JWT | Clear all AI conversation history. |
| `DELETE` | `/api/ai/history/:id` | Bearer JWT | Delete a specific AI message interaction. |

### 14. Personal Saved Items & Collections

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/saved-items` | Bearer JWT | List bookmarked items (`type`, `collectionId`, `tags`). |
| `POST` | `/api/saved-items` | Bearer JWT | Save a message, external link, post, or uploaded file. |
| `PATCH` | `/api/saved-items/:id` | Bearer JWT | Update notes, tags, or assign to a collection. |
| `DELETE` | `/api/saved-items/:id` | Bearer JWT | Remove item from saved bookmarks. |
| `GET` | `/api/saved-items/collections` | Bearer JWT | List custom user collections with item counts. |
| `POST` | `/api/saved-items/collections` | Bearer JWT | Create a new collection (name, description, color). |
| `PATCH` | `/api/saved-items/collections/:id` | Bearer JWT | Edit collection name or color. |
| `DELETE` | `/api/saved-items/collections/:id` | Bearer JWT | Delete collection (keeps saved items uncategorized). |

---

## Real-Time WebSocket Architecture

Quorum utilizes **Socket.IO** for low-latency bidirectional communication across messaging, community feeds, and video call signaling:

### Client Connection
Clients connect to `/` with JWT token authorization:
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: { token: 'Bearer <accessToken>' },
  transports: ['websocket']
});
```

### Core Event Catalog

| Domain | Event Sent by Client | Event Emitted by Server | Description |
| :--- | :--- | :--- | :--- |
| **Chat Messaging** | `message:send` | `message:new` | Real-time direct & group message dispatch with hydrated sender metadata. |
| **Message Updates** | `message:edit`, `message:delete` | `message:updated`, `message:deleted` | Real-time message content edits and message deletions. |
| **Typing State** | `typing:start`, `typing:stop` | `typing:start`, `typing:stop` | Typing indicator broadcast to conversation room participants. |
| **Read Receipts** | `message:read` | `message:read` | Read receipt timestamp broadcast to message senders. |
| **Community Feed** | — | `new_post`, `new_comment`, `post_updated` | Live community broadcast eliminating manual browser refreshes. |
| **Notifications** | — | `new_notification`, `unread_count_update` | Instant push notification badge increment. |
| **SFU Video Signaling** | `join-room`, `publish-track`, `subscribe-track`, `ice-candidate` | `track-published`, `user-joined`, `user-left`, `peer-ice-candidate` | WebRTC SDP negotiation and ICE candidate exchange for Werift SFU. |

---

## WebRTC / SFU Video Architecture

Quorum uses a custom Selective Forwarding Unit (SFU) architecture implemented on top of [Werift](https://github.com/shinyishi/werift-webrtc):

```
+-----------------------------------------------------------------------------------+
|                              QUORUM SELECTIVE FORWARDING UNIT                     |
|                                                                                   |
|  [Publisher A] ---> (DTLS/SRTP) ---> [Werift PeerConnection]                      |
|                                             |                                     |
|                                      (Native RTP Stream)                          |
|                                             |                                     |
|                          +------------------+------------------+                  |
|                          |                                     |                  |
|                          v                                     v                  |
|                  [Subscriber B]                         [Subscriber C]            |
|              (sendRtp Forwarding)                    (sendRtp Forwarding)         |
|                          |                                     |                  |
|                          v                                     v                  |
|                  [Participant B]                        [Participant C]           |
+-----------------------------------------------------------------------------------+
```

### SFU Engineering Highlights
- **Authentic SRTP Forwarding:** Native `sendRtp` routing ensures genuine DTLS-SRTP encryption without transcoding CPU overhead.
- **Dynamic Port Allocation:** Dedicated media port range `40000–40100/UDP` configured for AWS EC2 security groups.
- **NAT Traversal & Public IP Routing:** Automatic `ANNOUNCED_IP` injection into server ICE candidates ensures reliable peer connection traversal across corporate firewalls.
- **Freeze Prevention & Keyframe Recovery:** Automatic RTCP PLI (Picture Loss Indication) generation with rate-throttling requests instantaneous keyframes when new participants join mid-call.

---

## Background Queues & Workers

Quorum relies on **BullMQ** running over Redis for reliable asynchronous execution:

1. **`emailQueue`**: Asynchronous dispatch of transactional emails, OTP verification codes, and password reset instructions.
2. **`emailDigestQueue`**: Periodic compilation and dispatch of community digest updates.
3. **`reminderQueue`**: Precision scheduling for calendar events and meeting alerts. Schedules delayed jobs based on user-configured reminder lead times (e.g., 15 minutes before event start).
4. **`notificationQueue`**: Push notification dispatch via Firebase Cloud Messaging (FCM).

---

## Testing & Production Deployment

### Running Tests
```bash
npm run test
```

### Type Checking & Build
```bash
# Verify static types:
npx tsc --noEmit

# Compile to production bundle:
npm run build
```

### Production Execution
```bash
NODE_ENV=production npm start
```

### Security & Firewall Ports (EC2)
Ensure your cloud security groups allow:
- **Port 80 / 443 (TCP):** HTTP/HTTPS traffic (Nginx reverse proxy)
- **Port 5000 (TCP):** Node.js backend direct application port
- **Ports 40000–40100 (UDP):** WebRTC SFU media traffic (RTP / RTCP / STUN)

---

## Contributing & License

Contributions, bug reports, and pull requests are welcome!

Author: **Tushar Talan** ([@tusharTalan1](https://github.com/tusharTalan1))
License: ISC