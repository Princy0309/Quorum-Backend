# Quorum Backend

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-lightgrey.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.x-darkblue.svg)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-7+-red.svg)](https://redis.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-5.x-red.svg)](https://bullmq.io/)
[![WebRTC SFU](https://img.shields.io/badge/WebRTC-SFU%20Engine-orange.svg)](#webrtc--sfu-video-architecture)
[![Swagger](https://img.shields.io/badge/OpenAPI-3.0-brightgreen.svg)](https://swagger.io/)

Quorum is an enterprise-grade real-time collaboration and virtual workspace platform. It unites interactive 2.5D virtual offices, team chat, multi-tenant organizations, scoped teams, community forums with channels, collaborative whiteboards and rich-text documents, cross-organization project collaboration, calendar scheduling, automated AI workflows, and high-capacity WebRTC multi-party video conferencing backed by a custom Selective Forwarding Unit (SFU).

---

## Table of Contents

1. [Interactive Swagger API Documentation](#interactive-swagger-api-documentation)
2. [Key Platform Features](#key-platform-features)
3. [Architecture & Technology Stack](#architecture--technology-stack)
4. [Prerequisites & Getting Started](#prerequisites--getting-started)
5. [Environment Variables Reference](#environment-variables-reference)
6. [Complete REST API Catalog](#complete-rest-api-catalog)
   - [1. Health & Security](#1-health--security)
   - [2. Authentication & Sessions](#2-authentication--sessions)
   - [3. OTP & Email Verification](#3-otp--email-verification)
   - [4. User Management & Presence Status](#4-user-management--presence-status)
   - [5. Virtual Office Floor & Desks](#5-virtual-office-floor--desks)
   - [6. Direct & Group Conversations (Chat & Polls)](#6-direct--group-conversations-chat--polls)
   - [7. Communities, Channels & Invites](#7-communities-channels--invites)
   - [8. Community Posts & Comments](#8-community-posts--comments)
   - [9. Organizations, Teams, Feeds & Tasks](#9-organizations-teams-feeds--tasks)
   - [10. Calendar & Scheduled Reminders](#10-calendar--scheduled-reminders)
   - [11. Meetings & SFU Video Calling](#11-meetings--sfu-video-calling)
   - [12. Collaborative Whiteboards](#12-collaborative-whiteboards)
   - [13. Collaborative Documents](#13-collaborative-documents)
   - [14. Projects & Freelancer Collaboration](#14-projects--freelancer-collaboration)
   - [15. Meeting Recordings Lifecycle](#15-meeting-recordings-lifecycle)
   - [16. Atlassian Jira Cloud Integration](#16-atlassian-jira-cloud-integration)
   - [17. GitHub Integration](#17-github-integration)
   - [18. AI Assistant & Workflows](#18-ai-assistant--workflows)
   - [19. Notifications & Delivery Preferences](#19-notifications--delivery-preferences)
   - [20. Media & S3 File Storage](#20-media--s3-file-storage)
   - [21. Personal Saved Items & Collections](#21-personal-saved-items--collections)
7. [Real-Time WebSocket Architecture](#real-time-websocket-architecture)
8. [WebRTC / SFU Video Architecture](#webrtc--sfu-video-architecture)
9. [Background Queues & Workers](#background-queues--workers)
10. [Testing & Production Deployment](#testing--production-deployment)
11. [Authors & Contributors](#authors--contributors)

---

## Interactive Swagger API Documentation

Quorum Backend includes a fully interactive OpenAPI 3.0 specification covering **221 endpoints and 285+ operations** mounted via Swagger UI:

- **Swagger UI Interactive Console:** `http://localhost:5000/api-docs` (or `/api-docs` on your deployed server)
- **OpenAPI 3.0 JSON Document:** `http://localhost:5000/api-docs.json` or `/api-docs/swagger.json`

### Authentication in Swagger UI
1. Click **Authorize** (top right) in Swagger UI.
2. Enter your JWT token under `BearerAuth`: `Bearer <your_access_token>`.
3. Fetch a CSRF token from `GET /api/csrf-token` and enter it under `CSRFAuth` (`x-xsrf-token`).

---

## Key Platform Features

- **Interactive 2.5D Virtual Office:** Spatial virtual office floors with real-time desk occupancy, proximity zones (`OPEN_WORKSPACE`, `FOCUS_POD`, `COFFEE_LOUNGE`, `WAR_ROOM`), desk knocking notifications, and instant one-click War Room meeting launches.
- **Selective Forwarding Unit (SFU) Video Engine:** Multi-party audio/video conferencing using native RTP forwarding with authentic DTLS-SRTP encryption, RTCP PLI keyframe recovery, and dynamic UDP port routing (40000–40100).
- **Multi-Tenant Organizations & Scoped Teams:** Enterprise multi-tenancy with RBAC (`ORG_ADMIN`, `TEAM_HEAD`, `MEMBER`), scoped team workspaces, ownership transfer, company-wide announcement feeds with emoji reactions, and team task tracking.
- **Cross-Organization Projects & Freelancer Sandboxing:** External project collaboration with tokenized invites, custom roles (`PROJECT_LEAD`, `MEMBER`, `FREELANCER`, `VIEWER`), deliverables review workflows, and resource attachments.
- **Collaborative Whiteboards:** Element-level vector canvas synchronization, distributed Redis mutex locking (`SET NX PX` with Lua heartbeat renewal), optimistic concurrency versioning (`_version`), and debounced database persistence.
- **Collaborative Rich-Text Documents:** Real-time multi-user document editor with live cursors, in-meeting live canvas integration, and AI copilot rewriting.
- **Atlassian Jira Cloud Integration:** OAuth 2.0 (3LO) authorization flow, team issue creation, assigned ticket tracking, real-time workflow status transitions, and incoming webhook synchronization.
- **GitHub Integration:** OAuth 2.0 app connection, team repository linking, issue creation, pull request reviews, commit tracking, and branch synchronization.
- **Real-Time Direct & Group Messaging:** 1-on-1 direct messaging, group chats, interactive in-chat polls, message forwarding, pinned messages, chat muting/blocking, read receipts, and full-text search.
- **Real-Time Presence & Status:** Live user presence tracking with automatic idle detection (`AWAY`), custom status messages with duration auto-clearing, and seamless zone routing on the Virtual Office floor.
- **Autonomous AI Workflows & Workplace Assistant:** Multi-agent pipeline execution (`/plan` and `/execute`), contextual chat transcript summarization, grounded semantic search, and smart quick replies powered by Google Gemini.
- **Meeting Recordings Lifecycle:** Cloud video recording capture, multi-chunk upload coordination, post-processing status tracking, and 7-day auto-purge storage.
- **Granular Multi-Channel Notification Preferences:** Per-category notification control (`DIRECT_MESSAGE`, `COMMUNITY_POST_COMMENT`, `MEETING_STARTED`, `EVENT_REMINDER`, `ORG_INVITE`, `TEAM_INVITE`) across In-App, Push (FCM), and Email channels.
- **Calendar & Scheduled Reminders:** Collaborative event management integrated with BullMQ delayed queues for automated email delivery.
- **Enterprise Media Uploads:** Direct-to-S3 presigned URLs protected by a dual-tier rate limiting system (burst limiter: 10 req/min, daily quota: 100 uploads/24h).

---

## Architecture & Technology Stack

| Layer | Technologies | Purpose |
| :--- | :--- | :--- |
| **Runtime & Language** | Node.js 20+, TypeScript 5.x | High-throughput async I/O, static type safety |
| **Web Framework** | Express.js 4.x, CORS, Helmet, CSRF protection | REST API routing, security middleware, validation |
| **Database & ORM** | PostgreSQL 15+, Prisma ORM 5.x | Relational storage with multi-file modular schemas |
| **In-Memory Cache & Mutex** | Redis 7+ (`ioredis`) | Session revocation, OTP tracking, distributed board mutex, presence, burst rate limits |
| **Background Queues** | BullMQ 5.x | Asynchronous email dispatch, digests, scheduled calendar reminders, notification worker |
| **Real-Time Gateway** | Socket.IO 4.x | Bi-directional WebSocket events for chat, whiteboard, office floor, presence, SFU signaling |
| **Media / SFU Engine** | WebRTC SFU Media Engine | Low-latency multi-party audio/video forwarding (UDP 40000–40100) |
| **Enterprise Integrations** | Jira Cloud (3LO OAuth), GitHub (OAuth 2.0) | Cross-platform issue management, repository tracking, and webhooks |
| **Cloud Storage** | AWS S3 / Cloudflare R2 (`@aws-sdk/client-s3`) | Presigned secure file uploads, media storage, and call recordings |
| **Push Notifications** | Firebase Admin SDK (FCM) | Cross-platform mobile & web push notifications with preference filtering |
| **Workplace AI** | Google Gemini (`@google/genai`) | Contextual workplace intelligence, conversation summarization, workflow planning |
| **API Documentation** | Swagger UI (`swagger-ui-express`, OpenAPI 3.0) | Interactive API exploration and client generation |
| **Observability** | Winston 3.x | Structured JSON logging with daily file rotation and log levels |

---

## Prerequisites & Getting Started

### Prerequisites
- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **PostgreSQL** >= 15.0
- **Redis** >= 7.0
- **AWS S3 Bucket** (for media uploads and recordings)
- **SMTP Server** (Gmail, SendGrid, Amazon SES, or Mailgun)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Princy0309/Quorum-Backend.git
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

# AWS S3 / Cloudflare R2 Storage
AWS_REGION="your-aws-region"
AWS_ACCESS_KEY_ID="your-aws-access-key-id"
AWS_SECRET_ACCESS_KEY="your-aws-secret-access-key"
AWS_S3_BUCKET="your-s3-bucket-name"

# Google Gemini AI
GEMINI_API_KEY="your-gemini-api-key"

# Firebase Cloud Messaging (Push Notifications)
FIREBASE_SERVICE_ACCOUNT_PATH="./config/firebase-service-account.json"

# Atlassian Jira Integration
JIRA_CLIENT_ID="your-jira-client-id"
JIRA_CLIENT_SECRET="your-jira-client-secret"
JIRA_REDIRECT_URI="http://localhost:5000/api/integrations/jira/oauth/callback"

# GitHub Integration
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
GITHUB_REDIRECT_URI="http://localhost:5000/api/integrations/github/oauth/callback"

# WebRTC SFU Configuration
ANNOUNCED_IP="127.0.0.1"
RTC_MIN_PORT=40000
RTC_MAX_PORT=40100
STUN_SERVER="stun:stun.l.google.com:19302"
```

---

## Complete REST API Catalog

The server exposes standard REST APIs under `/api/*` (with `/api/v1/*` aliases). All state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require the `x-xsrf-token` header retrieved from `/api/csrf-token`.

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

### 4. User Management & Presence Status

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/users/search` | Bearer JWT | Global user directory search by name or email. |
| `GET` | `/api/users` | Bearer JWT | List users for direct messaging directory. |
| `GET` | `/api/users/profile` | Bearer JWT | Fetch current user profile. |
| `PATCH` | `/api/users/profile` | Bearer JWT | Update user bio, display name, and preferences. |
| `PATCH` | `/api/users/status` | Bearer JWT | Update presence status (`AVAILABLE`, `DO_NOT_DISTURB`, `BUSY`, `BE_RIGHT_BACK`, `AWAY`, `OFFLINE`). |
| `DELETE` | `/api/users/status` | Bearer JWT | Clear custom user status message. |
| `GET` | `/api/users/presence` | Bearer JWT | Get current user's real-time presence record. |
| `POST` | `/api/users/presence/batch` | Bearer JWT | Batch query presence for an array of `userIds`. |
| `GET` | `/api/users/:userId/presence` | Bearer JWT | Get presence status for a specific user. |

### 5. Virtual Office Floor & Desks

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/office/:teamId` | Bearer JWT | Retrieve real-time floor layout, seated members, zones, and war rooms. |
| `POST` | `/api/office/:teamId/join` | Bearer JWT | Enter the office floor and automatically be seated at an open desk. |
| `POST` | `/api/office/:teamId/leave` | Bearer JWT | Vacate current desk and leave the office floor. |
| `POST` | `/api/office/:teamId/knock` | Bearer JWT | Send a desk knock alert to a teammate with an optional note. |
| `POST` | `/api/office/:teamId/desk/claim` | Bearer JWT | Select and claim a specific desk in Open Workspace. |
| `POST` | `/api/office/:teamId/zone` | Bearer JWT | Move to `OPEN_WORKSPACE`, `FOCUS_POD` (auto DND), `COFFEE_LOUNGE` (auto BRB), or `WAR_ROOM`. |
| `POST` | `/api/office/:teamId/meeting/start` | Bearer JWT | Launch an instant collaborative War Room video meeting. |
| `POST` | `/api/office/:teamId/meeting/end` | Bearer JWT | End the active War Room meeting session. |

### 6. Direct & Group Conversations (Chat & Polls)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/conversations` | Bearer JWT | List all direct and group conversations for the user. |
| `GET` | `/api/conversations/unread-count` | Bearer JWT | Get total unread message count across all conversations. |
| `POST` | `/api/conversations/direct` | Bearer JWT | Get or initialize a 1-on-1 direct conversation. |
| `POST` | `/api/conversations/group` | Bearer JWT | Create a new multi-participant group chat. |
| `GET` | `/api/conversations/:id` | Bearer JWT | Get conversation metadata and participant list. |
| `GET` | `/api/conversations/:id/messages` | Bearer JWT | Fetch paginated chat history with mentions & media. |
| `POST` | `/api/conversations/:id/messages` | Bearer JWT | Send a message (supports `@mentions`, attachments). |
| `POST` | `/api/conversations/messages/forward` | Bearer JWT | Forward messages to multiple target conversations. |
| `POST` | `/api/conversations/:id/messages/poll` | Bearer JWT | Create an interactive poll inside the conversation. |
| `POST` | `/api/conversations/:id/messages/:messageId/poll/vote` | Bearer JWT | Cast vote in a conversation poll. |
| `POST` | `/api/conversations/:id/messages/:messageId/pin` | Bearer JWT | Pin message to the top of the conversation. |
| `DELETE` | `/api/conversations/:id/messages/:messageId/pin` | Bearer JWT | Unpin a message from the conversation. |
| `GET` | `/api/conversations/:id/pinned` | Bearer JWT | List all pinned messages in the conversation. |
| `POST` | `/api/conversations/:id/read` | Bearer JWT | Mark all messages in conversation as read. |
| `POST` | `/api/conversations/:id/clear` | Bearer JWT | Clear conversation message history for the user. |
| `POST` | `/api/conversations/:id/mute` | Bearer JWT | Mute conversation push and audio alerts. |
| `POST` | `/api/conversations/:id/unmute` | Bearer JWT | Unmute conversation alerts. |
| `POST` | `/api/conversations/:id/block` | Bearer JWT | Block communication in direct conversation. |
| `POST` | `/api/conversations/:id/unblock` | Bearer JWT | Unblock direct conversation. |
| `POST` | `/api/conversations/:id/leave` | Bearer JWT | Voluntarily leave a group conversation. |

### 7. Communities, Channels & Invites

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/communities` | Bearer JWT | Create a new community workspace. |
| `GET` | `/api/communities` | Bearer JWT | List joined communities. |
| `GET` | `/api/communities/discover` | Bearer JWT | Explore publicly discoverable communities. |
| `GET` | `/api/communities/feed` | Bearer JWT | Unified aggregate feed across all joined communities. |
| `GET` | `/api/communities/:id` | Bearer JWT | Get community metadata, rules, and member stats. |
| `PATCH` | `/api/communities/:id` | Bearer JWT | Update community title, description, or visibility. |
| `DELETE` | `/api/communities/:id` | Bearer JWT | Delete community (Owner only). |
| `POST` | `/api/communities/:id/leave` | Bearer JWT | Leave community (auto-transfers ownership if sole owner). |
| `POST` | `/api/communities/:id/transfer-ownership` | Bearer JWT | Transfer community ownership to another member. |
| `GET` | `/api/communities/:id/members` | Bearer JWT | List members with roles (`OWNER`, `ADMIN`, `MODERATOR`, `MEMBER`). |
| `PATCH` | `/api/communities/:id/members/:userId/role` | Bearer JWT | Update member role. |
| `DELETE` | `/api/communities/:id/members/:userId` | Bearer JWT | Kick a member from the community. |
| `GET` | `/api/communities/:id/search-users` | Bearer JWT | Search eligible users to invite. |
| `POST` | `/api/communities/:id/invites` | Bearer JWT | Create an invitation token. |
| `GET` | `/api/communities/invitations/pending` | Bearer JWT | List all pending invitations received by current user. |
| `POST` | `/api/communities/invitations/:identifier/accept` | Bearer JWT | Accept community invitation. |
| `POST` | `/api/communities/invitations/:identifier/decline` | Bearer JWT | Decline community invitation. |
| `GET` | `/api/communities/:id/channels` | Bearer JWT | List discussion channels within community. |
| `POST` | `/api/communities/:id/channels` | Bearer JWT | Create a new discussion channel (e.g., `#dev`). |
| `GET` | `/api/communities/:id/channels/:channelId/posts` | Bearer JWT | List paginated posts within a channel. |
| `POST` | `/api/communities/:id/channels/:channelId/posts` | Bearer JWT | Publish a post into a channel. |

### 8. Community Posts & Comments

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

### 9. Organizations, Teams, Feeds & Tasks

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/organizations` | Bearer JWT | Create an enterprise organization. |
| `GET` | `/api/organizations` | Bearer JWT | List organizations user belongs to. |
| `GET` | `/api/organizations/:id` | Bearer JWT | Get organization details and team hierarchy. |
| `PATCH` | `/api/organizations/:id` | Bearer JWT | Update organization settings (Requires `ORG_ADMIN`). |
| `POST` | `/api/organizations/:id/transfer-ownership` | Bearer JWT | Transfer primary organization ownership. |
| `POST` | `/api/organizations/:id/leave` | Bearer JWT | Leave an organization. |
| `GET` | `/api/organizations/:id/members` | Bearer JWT | List organization members and roles. |
| `POST` | `/api/organizations/:id/invites` | Bearer JWT | Create organization invite token. |
| `GET` | `/api/organizations/join/:token` | None | Preview organization invite metadata. |
| `POST` | `/api/organizations/join/:token` | Bearer JWT | Accept and join organization via invite token. |
| `POST` | `/api/organizations/:id/teams` | Bearer JWT | Create a scoped team within organization. |
| `GET` | `/api/organizations/:id/teams` | Bearer JWT | List all teams in organization. |
| `GET` | `/api/organizations/:id/teams/:teamId` | Bearer JWT | Get team metadata and member roster. |
| `GET` | `/api/organizations/:id/feed` | Bearer JWT | Get company-wide announcement feed. |
| `POST` | `/api/organizations/:id/feed` | Bearer JWT | Create company-wide announcement post. |
| `POST` | `/api/organizations/:id/feed/:postId/pin` | Bearer JWT | Pin/unpin announcement post. |
| `POST` | `/api/organizations/:id/feed/:postId/react` | Bearer JWT | Add emoji reaction to feed post. |
| `POST` | `/api/organizations/:id/feed/:postId/comments` | Bearer JWT | Comment on company announcement. |
| `GET` | `/api/organizations/:id/teams/:teamId/tasks` | Bearer JWT | List team tasks. |
| `POST` | `/api/organizations/:id/teams/:teamId/tasks` | Bearer JWT | Create a new task assigned to team members. |
| `PATCH` | `/api/organizations/:id/teams/:teamId/tasks/:taskId/status` | Bearer JWT | Update task status (`TODO`, `IN_PROGRESS`, `DONE`). |
| `GET` | `/api/organizations/:id/tasks/my` | Bearer JWT | List all organization tasks assigned to current user. |

### 10. Calendar & Scheduled Reminders

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/calendar` | Bearer JWT | Create a calendar event (`REMINDER`, `MEETING`, `DEADLINE`, `GENERAL`) with BullMQ reminder scheduling. |
| `GET` | `/api/calendar/month` | Bearer JWT | Query events for a specific month (`year`, `month`). |
| `GET` | `/api/calendar/date` | Bearer JWT | Query events for a single day (`date=YYYY-MM-DD`). |
| `GET` | `/api/calendar/upcoming` | Bearer JWT | Fetch chronologically sorted upcoming events. |
| `GET` | `/api/calendar/:id` | Bearer JWT | Get event details by ID. |
| `PATCH` | `/api/calendar/:id` | Bearer JWT | Update event details and dynamically reschedule BullMQ reminders. |
| `DELETE` | `/api/calendar/:id` | Bearer JWT | Delete event and cancel its pending background reminder job. |

### 11. Meetings & SFU Video Calling

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/meetings` | Bearer JWT | Create a new video meeting session with a unique call code. |
| `POST` | `/api/meetings/scoped` | Bearer JWT | Create or schedule a meeting scoped to an Org, Team, or Community. |
| `GET` | `/api/meetings/upcoming` | Bearer JWT | Get upcoming scheduled meetings across all workspaces. |
| `GET` | `/api/meetings/organization/:organizationId` | Bearer JWT | List meetings associated with an organization. |
| `GET` | `/api/meetings/team/:teamId` | Bearer JWT | List meetings associated with a team. |
| `GET` | `/api/meetings/:code` | Bearer JWT | Retrieve active meeting state, participant count, and metadata. |
| `PATCH` | `/api/meetings/:code/cancel` | Bearer JWT | Cancel a scheduled meeting. |
| `POST` | `/api/meetings/:code/end` | Bearer JWT | Terminate meeting session and disconnect SFU peer connections. |
| `GET` | `/api/meetings/:code/whiteboards` | Bearer JWT | List whiteboards linked to the meeting. |
| `POST` | `/api/meetings/:code/whiteboards` | Bearer JWT | Create and link whiteboard to meeting. |
| `POST` | `/api/meetings/:code/whiteboards/:whiteboardId/open` | Bearer JWT | Broadcast whiteboard live inside the meeting. |

### 12. Collaborative Whiteboards

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/whiteboards` | Bearer JWT | List whiteboards within the user's organizations (`organizationId`, `search`). |
| `POST` | `/api/whiteboards` | Bearer JWT | Create a new organization whiteboard canvas (`title`, `content`). |
| `GET` | `/api/whiteboards/:id` | Bearer JWT | Retrieve full whiteboard state, element tree, and view state. |
| `PATCH` | `/api/whiteboards/:id` | Bearer JWT | Coordinated update protected by distributed Redis locking. |
| `DELETE` | `/api/whiteboards/:id` | Bearer JWT | Permanently delete whiteboard and clean up Redis session keys. |

### 13. Collaborative Documents

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/documents` | Bearer JWT | List accessible rich-text collaborative documents. |
| `POST` | `/api/documents` | Bearer JWT | Create a new document (`title`, `content`, `scopeType`). |
| `GET` | `/api/documents/:id` | Bearer JWT | Fetch document content, version history, and collaborators. |
| `PATCH` | `/api/documents/:id` | Bearer JWT | Update document title or content. |
| `DELETE` | `/api/documents/:id` | Bearer JWT | Delete document. |
| `POST` | `/api/documents/:id/open-in-meeting` | Bearer JWT | Open and present document live inside active video call. |

### 14. Projects & Freelancer Collaboration

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/projects` | Bearer JWT | List accessible project workspaces. |
| `GET` | `/api/projects/my-projects` | Bearer JWT | List projects where the user is an owner, lead, member, or external freelancer. |
| `POST` | `/api/projects` | Bearer JWT | Create a new cross-organization project workspace. |
| `GET` | `/api/projects/invites/preview/:token` | None | Public preview of project invitation before joining. |
| `POST` | `/api/projects/invites/accept` | Bearer JWT | Accept project invitation token. |
| `POST` | `/api/projects/:id/members/invite` | Bearer JWT | Invite member or freelancer (`PROJECT_LEAD`, `MEMBER`, `FREELANCER`, `VIEWER`). |
| `PATCH` | `/api/projects/:id/members/:userId` | Bearer JWT | Update project member role. |
| `DELETE` | `/api/projects/:id/members/:userId` | Bearer JWT | Remove member from project. |
| `GET` | `/api/projects/:id/resources` | Bearer JWT | List external reference links, Figma docs, and deliverables. |
| `POST` | `/api/projects/:id/resources` | Bearer JWT | Attach a resource link or deliverable file. |
| `DELETE` | `/api/projects/:id/resources/:resourceId` | Bearer JWT | Remove project resource attachment. |

### 15. Meeting Recordings Lifecycle

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/recordings/start` | Bearer JWT | Initiate meeting recording session. |
| `POST` | `/api/recordings/stop` | Bearer JWT | Stop active meeting recording. |
| `POST` | `/api/recordings/upload-url` | Bearer JWT | Generate presigned URL for client recording chunk upload. |
| `POST` | `/api/recordings/:id/complete` | Bearer JWT | Finalize recording upload and trigger background processing. |
| `GET` | `/api/recordings/:id` | Bearer JWT | Fetch recording metadata, duration, and download URL. |
| `POST` | `/api/recordings/:id/summarize` | Bearer JWT | Generate AI executive summary of recorded call transcript. |

### 16. Atlassian Jira Cloud Integration

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/integrations/jira/oauth/authorize-url` | Bearer JWT | Generate Atlassian OAuth 2.0 (3LO) authorization URL. |
| `GET` | `/api/integrations/jira/oauth/callback` | None | Handle Atlassian OAuth callback and exchange authorization code. |
| `GET` | `/api/integrations/jira/oauth/status` | Bearer JWT | Retrieve Jira Cloud connection status and site metadata. |
| `POST` | `/api/integrations/jira/disconnect` | Bearer JWT | Revoke Jira OAuth credentials and disconnect site. |
| `GET` | `/api/integrations/jira/teams/:teamId/tickets` | Bearer JWT | List Jira issues linked to team project. |
| `POST` | `/api/integrations/jira/teams/:teamId/tickets` | Bearer JWT | Create a Jira issue from team context. |
| `GET` | `/api/integrations/jira/teams/:teamId/tickets/:key` | Bearer JWT | Get full details of a team Jira issue. |
| `POST` | `/api/integrations/jira/teams/:teamId/tickets/:key/transition` | Bearer JWT | Transition a team Jira ticket status (`In Progress`, `Done`). |
| `GET` | `/api/integrations/jira/teams/:teamId/assignees` | Bearer JWT | List assignable Jira users for team project. |
| `POST` | `/api/webhooks/jira` | Webhook Sig | Real-time webhook receiver for Jira Cloud issue events. |

### 17. GitHub Integration

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/integrations/github/authorize-url` | Bearer JWT | Generate GitHub OAuth 2.0 app authorization URL. |
| `GET` | `/api/integrations/github/oauth/callback` | None | Handle GitHub OAuth callback and save access token. |
| `GET` | `/api/integrations/github/status` | Bearer JWT | Check current GitHub integration status. |
| `POST` | `/api/integrations/github/disconnect` | Bearer JWT | Disconnect and revoke GitHub integration. |
| `GET` | `/api/integrations/github/user/repos` | Bearer JWT | Fetch accessible public and private GitHub repositories. |
| `GET` | `/api/integrations/github/teams/:teamId/repo` | Bearer JWT | Get linked GitHub repository for a team. |
| `POST` | `/api/integrations/github/teams/:teamId/repo` | Bearer JWT | Link a GitHub repository to a team workspace. |
| `DELETE` | `/api/integrations/github/teams/:teamId/repo` | Bearer JWT | Unlink repository from team workspace. |
| `GET` | `/api/integrations/github/teams/:teamId/issues` | Bearer JWT | List issues from linked GitHub repository. |
| `POST` | `/api/integrations/github/teams/:teamId/issues` | Bearer JWT | Create a new issue in linked repository. |
| `PATCH` | `/api/integrations/github/teams/:teamId/issues/:issueNumber` | Bearer JWT | Update issue state or assignees. |
| `GET` | `/api/integrations/github/teams/:teamId/pulls` | Bearer JWT | Fetch open and closed pull requests. |
| `GET` | `/api/integrations/github/teams/:teamId/commits` | Bearer JWT | Fetch recent commit history. |
| `GET` | `/api/integrations/github/teams/:teamId/branches` | Bearer JWT | List branches and protection rules. |
| `GET` | `/api/integrations/github/teams/:teamId/collaborators` | Bearer JWT | List repository collaborators. |

### 18. AI Assistant & Workflows

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/ai/chat` | Bearer JWT | Context-aware chat with Gemini AI. |
| `POST` | `/api/ai/summarize` | Bearer JWT | Generate concise summaries of workspace content. |
| `POST` | `/api/ai/chat/:conversationId/summary` | Bearer JWT | Summarize chat transcript into key takeaways and action items. |
| `POST` | `/api/ai/search` | Bearer JWT | Semantic search across workspace messages and documents. |
| `POST` | `/api/ai/assist` | Bearer JWT | Context-aware writing and productivity assistance. |
| `POST` | `/api/ai/quick-replies` | Bearer JWT | Generate smart contextual replies for messages. |
| `POST` | `/api/ai/workflows/plan` | Bearer JWT | Plan autonomous multi-agent execution pipeline. |
| `POST` | `/api/ai/workflows/execute` | Bearer JWT | Execute structured workflow tasks. |

### 19. Notifications & Delivery Preferences

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/notifications` | Bearer JWT | Get paginated notifications (`unreadOnly`, `page`, `limit`). |
| `GET` | `/api/notifications/unread-count` | Bearer JWT | Get unread notification count for badge indicators. |
| `PATCH` | `/api/notifications/read-all` | Bearer JWT | Mark all notifications as read. |
| `PATCH` | `/api/notifications/:id/read` | Bearer JWT | Mark specific notification as read. |
| `DELETE` | `/api/notifications/:id` | Bearer JWT | Delete a notification. |
| `GET` | `/api/notifications/preferences` | Bearer JWT | Get user delivery preferences across all categories with defaults. |
| `PUT` / `PATCH` / `POST` | `/api/notifications/preferences` | Bearer JWT | Update notification preferences (supports single item, array, or key-value map). |
| `POST` | `/api/devices` | Bearer JWT | Register FCM device token for mobile push alerts. |
| `DELETE` | `/api/devices` | Bearer JWT | Unregister FCM token on logout. |

### 20. Media & S3 File Storage

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/uploads/sign` | Bearer JWT | Generate AWS S3 presigned PUT URL with mime-type validation. Rate limited to 10 req/min (burst) and 100 uploads/24h (quota). |
| `POST` | `/api/uploads/s3` | Bearer JWT | Direct multipart file upload endpoint to S3 with rate limit enforcement. |

### 21. Personal Saved Items & Collections

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

Quorum utilizes **Socket.IO** for low-latency bidirectional communication across messaging, virtual office floors, interactive whiteboards, and video call signaling:

### Client Connection & Auto-Healing Resilience
Clients connect to `/` with JWT authorization. The gateway features **transparent session auto-healing**:
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: { token: 'Bearer <accessToken>' },
  withCredentials: true,
  transports: ['websocket']
});
```

- **Expired Token Recovery:** When a short-lived (15-minute) access token expires in memory, the server inspects the active `refreshToken` cookie sent in the handshake headers.
- **Database Verification:** It verifies the cryptographic signature and queries PostgreSQL (`prisma.refreshToken.findUnique`). If the session is active and not revoked (`!storedToken.revokedAt`), the socket is authenticated transparently without disconnecting the user.

### Core Event Catalog

| Domain | Event Sent by Client | Event Emitted by Server | Description |
| :--- | :--- | :--- | :--- |
| **Virtual Office** | `office:join`, `office:leave`, `office:zone:change`, `office:desk:claim`, `office:knock` | `office:member:joined`, `office:member:left`, `office:floor:update`, `office:knock:received` | Real-time floor occupancy, desk allocations, zone movements, and proximity knocking. |
| **User Presence** | `presence:heartbeat`, `presence:set-status` | `presence:update`, `presence:batch` | Real-time user online/activity state and custom status message broadcasts. |
| **Chat Messaging** | `message:send` | `message:new` | Real-time direct & group message dispatch with hydrated sender metadata. |
| **Message Updates** | `message:edit`, `message:delete` | `message:updated`, `message:deleted` | Real-time message content edits and message deletions. |
| **Typing State** | `typing:start`, `typing:stop` | `typing:start`, `typing:stop` | Typing indicator broadcast to conversation room participants. |
| **Read Receipts** | `message:read` | `message:read` | Read receipt timestamp broadcast to message senders. |
| **Community Feed** | — | `new_post`, `new_comment`, `post_updated` | Live community broadcast eliminating manual browser refreshes. |
| **Notifications** | — | `notification:new`, `unread_count_update` | Instant push notification badge increment. |
| **Whiteboard Session** | `whiteboard:join`, `whiteboard:leave` | `whiteboard:user-joined`, `whiteboard:user-left` | Board room joining, presence tracking across cluster nodes via Redis hashes (`whiteboard:<id>:users`). |
| **Whiteboard Drawing** | `whiteboard:draw-element`, `whiteboard:elements-change` | `whiteboard:element-updated`, `whiteboard:elements-changed` | Fine-grained element-level synchronization, version incrementing, and peer broadcast. |
| **Whiteboard Cursors** | `whiteboard:cursor-move` | `whiteboard:cursor-moved` | Ephemeral, throttled (40ms) live cursor position broadcasting. |
| **Document Collaboration** | `doc:join`, `doc:change`, `doc:cursor` | `doc:update`, `doc:cursor:moved`, `doc:user:joined` | Multi-user live rich-text document editing and cursor presence. |
| **SFU Video Signaling** | `join-room`, `publish-track`, `subscribe-track`, `ice-candidate` | `track-published`, `user-joined`, `user-left`, `peer-ice-candidate` | WebRTC SDP negotiation and ICE candidate exchange for custom SFU engine. |

---

## WebRTC / SFU Video Architecture

Quorum uses a custom Selective Forwarding Unit (SFU) architecture implemented as a native WebRTC media engine:

```
+-----------------------------------------------------------------------------------+
|                              QUORUM SELECTIVE FORWARDING UNIT                     |
|                                                                                   |
|  [Publisher A] ---> (DTLS/SRTP) ---> [SFU Media Engine]                           |
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
4. **`notificationQueue`**: Push notification dispatch via Firebase Cloud Messaging (FCM) with user preference enforcement.

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

## Authors & Contributors

- **Princy Mishra** ([@Princy0309](https://github.com/Princy0309))
- **Tushar Talan** ([@tusharTalan1](https://github.com/tusharTalan1))

---

## Contributing & License

Contributions, bug reports, and pull requests are welcome!

License: ISC
