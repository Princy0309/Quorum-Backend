# Frontend Integration Guide: Community Discovery & Join Requests

This document is the official frontend integration guide for **Community Discovery, Public Search, and Admin-Moderated Join Requests** across Web, Mobile (React Native / Flutter), and Desktop clients.

---

## 📋 Table of Contents
1. [🌟 Feature Overview](#-feature-overview)
2. [🛠️ API Endpoints Summary](#️-api-endpoints-summary)
3. [🔍 Community Search & Discovery API](#-community-search--discovery-api)
4. [📬 Join Request Lifecycle APIs](#-join-request-lifecycle-apis)
5. [🛡️ Admin Moderation APIs](#️-admin-moderation-apis)
6. [🔔 Real-Time Socket.IO & Push Notifications](#-real-time-socketio--push-notifications)
7. [📐 TypeScript Models & Interfaces](#-typescript-models--interfaces)
8. [💻 Ready-to-Use UI Code Examples](#-ready-to-use-ui-code-examples)

---

## 🌟 Feature Overview

1. **Global Public Discovery (`GET /api/communities/search` or `/discover`)**:
   - Searches public communities across Quorum with text search (`q` or `search`) and cursor-based pagination.
   - Automatically computes dynamic `membershipStatus` relative to the authenticated caller:
     - `OWNER`: Caller is the owner/creator.
     - `ADMIN`: Caller has administrative rights in this community.
     - `MEMBER`: Caller is already an active member.
     - `PENDING_REQUEST`: Caller has an open join request awaiting admin approval.
     - `NOT_MEMBER`: Caller has not joined and has no open request.
   - Attaches `pendingRequestId` when status is `PENDING_REQUEST` for instant single-click cancellation.

2. **Send Join Request (`POST /api/communities/:id/join-requests`)**:
   - Sends a join request with an optional note/message (up to 500 characters) to community administrators.
   - Queues in-app and push notifications for community owners and admins.

3. **User Pending Requests View (`GET /api/communities/join-requests/my`)**:
   - Displays all communities where the user is currently awaiting admin approval.

4. **Cancel Request (`DELETE /api/communities/:id/join-requests`)**:
   - Allows users to withdraw their pending join request before an admin responds.

5. **Admin Moderation (`GET`, `POST accept`, `POST reject`)**:
   - Owners and Admins view applicant queues with user profile metadata.
   - **Accepting**: Marks request `ACCEPTED`, creates `CommunityMember` with role `MEMBER`, and emits real-time notification to the applicant.
   - **Rejecting**: Marks request `REJECTED` with an optional reason note and emits real-time notification to the applicant.

---

## 🛠️ API Endpoints Summary

| Method | Endpoint | Description | Auth Required | Access Level |
| :--- | :--- | :--- | :---: | :--- |
| **GET** | `/api/communities/search?q=...&limit=20` | Search/Discover public communities with membership status | ✅ Bearer / Cookie | Any User |
| **GET** | `/api/communities/discover` | Alias for community discovery | ✅ Bearer / Cookie | Any User |
| **POST** | `/api/communities/:id/join-requests` | Send join request to community admins | ✅ Bearer / Cookie | Non-Members |
| **GET** | `/api/communities/join-requests/my` | List caller's active pending join requests | ✅ Bearer / Cookie | Any User |
| **DELETE**| `/api/communities/:id/join-requests` | Cancel caller's pending join request | ✅ Bearer / Cookie | Applicant |
| **GET** | `/api/communities/:id/join-requests` | View pending applicant queue for community | ✅ Bearer / Cookie | Admin / Owner |
| **POST** | `/api/communities/:id/join-requests/:requestId/accept` | Accept applicant and add as member | ✅ Bearer / Cookie | Admin / Owner |
| **POST** | `/api/communities/:id/join-requests/:requestId/reject` | Reject applicant with optional reason | ✅ Bearer / Cookie | Admin / Owner |

---

## 🔍 Community Search & Discovery API

### `GET /api/communities/search` (or `/api/communities/discover`)

#### Query Parameters:
| Param | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `q` or `search` | `string` | No | Search query matching community name or description |
| `limit` | `number` | No | Number of records to return (default: `20`, max: `50`) |
| `cursor` | `string` | No | Pagination cursor (received as `nextCursor` from prior response) |

#### Request Headers:
```http
Authorization: Bearer <accessToken>
x-client-platform: mobile   <-- (Only for mobile clients)
```

#### Successful Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "communities": [
      {
        "id": "74592439-080e-4d72-a60c-3c23300d9f2f",
        "name": "Fullstack Developers",
        "description": "A place for frontend and backend engineers to collaborate.",
        "icon": "https://s3.amazonaws.com/quorum/communities/fullstack.png",
        "createdAt": "2026-10-20T10:00:00.000Z",
        "memberCount": 142,
        "channelCount": 6,
        "membershipStatus": "NOT_MEMBER",
        "pendingRequestId": null
      },
      {
        "id": "e4a781b2-1321-4f11-9252-c3f253e97f90",
        "name": "AI Engineers",
        "description": "Discussing LLMs, PyTorch, and generative AI apps.",
        "icon": null,
        "createdAt": "2026-10-25T14:30:00.000Z",
        "memberCount": 88,
        "channelCount": 4,
        "membershipStatus": "PENDING_REQUEST",
        "pendingRequestId": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0"
      },
      {
        "id": "93a15264-b001-4475-8f64-dcb41203b879",
        "name": "Design Systems",
        "description": "Figma, Tailwind, and UI/UX design tokens.",
        "icon": null,
        "createdAt": "2026-10-18T08:00:00.000Z",
        "memberCount": 54,
        "channelCount": 3,
        "membershipStatus": "MEMBER",
        "pendingRequestId": null
      }
    ],
    "nextCursor": "2026-10-25T14:30:00.000Z",
    "hasMore": false
  }
}
```

---

## 📬 Join Request Lifecycle APIs

### 1. Send Join Request
**`POST /api/communities/:id/join-requests`**

#### Request Body (`application/json`):
```json
{
  "message": "Hi, I am excited to join and contribute to this community!"
}
```
*(Note: `message` is optional, max 500 characters).*

#### Response (`201 Created`):
```json
{
  "success": true,
  "message": "Join request sent successfully",
  "data": {
    "id": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
    "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
    "userId": "984aaa79-1a9f-4896-941b-8a3a44171f1b",
    "status": "PENDING",
    "message": "Hi, I am excited to join and contribute to this community!",
    "createdAt": "2026-11-01T10:00:00.000Z"
  }
}
```

---

### 2. View My Pending Join Requests
**`GET /api/communities/join-requests/my`** (or `/api/communities/join-requests/pending`)

#### Response (`200 OK`):
```json
{
  "success": true,
  "data": [
    {
      "id": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
      "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
      "status": "PENDING",
      "message": "Hi, I am excited to join and contribute to this community!",
      "createdAt": "2026-11-01T10:00:00.000Z",
      "community": {
        "id": "e4a781b2-1321-4f11-9252-c3f253e97f90",
        "name": "AI Engineers",
        "description": "Discussing LLMs, PyTorch, and generative AI apps.",
        "icon": null
      }
    }
  ]
}
```

---

### 3. Cancel Pending Join Request
**`DELETE /api/communities/:id/join-requests`**

#### Response (`200 OK`):
```json
{
  "success": true,
  "message": "Join request cancelled successfully"
}
```

---

## 🛡️ Admin Moderation APIs

> **Permissions**: Only community **OWNER** and **ADMIN** can access these routes. Regular members or non-members receive `403 Forbidden`.

### 1. View Community Join Requests
**`GET /api/communities/:id/join-requests?status=PENDING`**

#### Query Parameters:
- `status` *(optional)*: `PENDING` (default), `ACCEPTED`, `REJECTED`, or `CANCELLED`.

#### Response (`200 OK`):
```json
{
  "success": true,
  "data": [
    {
      "id": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
      "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
      "userId": "984aaa79-1a9f-4896-941b-8a3a44171f1b",
      "status": "PENDING",
      "message": "Hi, I am excited to join and contribute to this community!",
      "createdAt": "2026-11-01T10:00:00.000Z",
      "user": {
        "id": "984aaa79-1a9f-4896-941b-8a3a44171f1b",
        "name": "Alice Johnson",
        "email": "alice@example.com",
        "avatar": "https://s3.amazonaws.com/quorum/avatars/alice.png"
      }
    }
  ]
}
```

---

### 2. Accept Join Request
**`POST /api/communities/:id/join-requests/:requestId/accept`**

- Adds the applicant as a `MEMBER` of the community.
- Sends an in-app and push notification to the applicant.

#### Response (`200 OK`):
```json
{
  "success": true,
  "message": "Join request accepted successfully",
  "data": {
    "requestId": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
    "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
    "member": {
      "id": "5123a101-b201-4475-8f64-dcb41203b879",
      "userId": "984aaa79-1a9f-4896-941b-8a3a44171f1b",
      "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
      "role": "MEMBER"
    }
  }
}
```

---

### 3. Reject Join Request
**`POST /api/communities/:id/join-requests/:requestId/reject`**

#### Request Body (`application/json`):
```json
{
  "reason": "Does not meet community prerequisites."
}
```
*(Note: `reason` is optional, max 500 characters).*

#### Response (`200 OK`):
```json
{
  "success": true,
  "message": "Join request rejected",
  "data": {
    "requestId": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
    "status": "REJECTED"
  }
}
```

---

## 🔔 Real-Time Socket.IO & Push Notifications

The backend automatically creates persistent notifications and emits real-time events over Socket.IO to user rooms (`user:<userId>`):

| Event Type | Recipient | Triggered When | Action on Frontend |
| :--- | :--- | :--- | :--- |
| `COMMUNITY_JOIN_REQUEST` | Community Owner & Admins | User sends a join request | Show badge / toast on admin moderation icon |
| `COMMUNITY_JOIN_ACCEPTED` | Applicant User | Admin accepts join request | Show congratulations toast; refresh joined communities |
| `COMMUNITY_JOIN_REJECTED` | Applicant User | Admin rejects join request | Show notification with rejection reason |

#### Example Socket Client Listener:
```typescript
socket.on('notification:new', (notification) => {
  if (notification.type === 'COMMUNITY_JOIN_REQUEST') {
    // Admin receives new applicant notification
    toast.info(`New join request: ${notification.body}`);
  } else if (notification.type === 'COMMUNITY_JOIN_ACCEPTED') {
    // User accepted into community
    toast.success(`You have been accepted into ${notification.metadata?.communityName || 'the community'}!`);
  } else if (notification.type === 'COMMUNITY_JOIN_REJECTED') {
    // User request rejected
    toast.error(`Your join request was declined: ${notification.body}`);
  }
});
```

---

## 📐 TypeScript Models & Interfaces

```typescript
export type MembershipStatus =
  | 'OWNER'
  | 'ADMIN'
  | 'MEMBER'
  | 'PENDING_REQUEST'
  | 'NOT_MEMBER';

export interface DiscoveredCommunity {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  createdAt: string;
  memberCount: number;
  channelCount: number;
  membershipStatus: MembershipStatus;
  pendingRequestId: string | null;
}

export interface CommunityJoinRequest {
  id: string;
  communityId: string;
  userId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  message?: string | null;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  };
  community?: {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
  };
}
```

---

## 💻 Ready-to-Use UI Code Examples

### 1. Community Discovery Card (React Web)

```tsx
import React, { useState } from 'react';
import axios from 'axios';
import { DiscoveredCommunity } from './types';

export const CommunityCard: React.FC<{
  community: DiscoveredCommunity;
  onRefresh: () => void;
}> = ({ community, onRefresh }) => {
  const [loading, setLoading] = useState(false);

  const handleRequestJoin = async () => {
    try {
      setLoading(true);
      await axios.post(`/api/communities/${community.id}/join-requests`, {
        message: 'Excited to join this community!',
      });
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to send request');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    try {
      setLoading(true);
      await axios.delete(`/api/communities/${community.id}/join-requests`);
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to cancel request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-4 border rounded-xl shadow-sm bg-white dark:bg-zinc-900">
      <div className="flex items-center space-x-3">
        {community.icon ? (
          <img src={community.icon} alt={community.name} className="w-12 h-12 rounded-full object-cover" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">
            {community.name.charAt(0)}
          </div>
        )}
        <div>
          <h4 className="font-semibold text-base">{community.name}</h4>
          <p className="text-xs text-gray-500 line-clamp-1">{community.description}</p>
          <span className="text-[11px] text-gray-400">{community.memberCount} members</span>
        </div>
      </div>

      <div>
        {['MEMBER', 'ADMIN', 'OWNER'].includes(community.membershipStatus) ? (
          <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
            Joined ({community.membershipStatus})
          </span>
        ) : community.membershipStatus === 'PENDING_REQUEST' ? (
          <button
            onClick={handleCancelRequest}
            disabled={loading}
            className="px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-semibold rounded-full transition"
          >
            Requested (Cancel)
          </button>
        ) : (
          <button
            onClick={handleRequestJoin}
            disabled={loading}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-full transition"
          >
            {loading ? 'Sending...' : 'Request to Join'}
          </button>
        )}
      </div>
    </div>
  );
};
```

---

### 2. Admin Moderation Modal (React)

```tsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { CommunityJoinRequest } from './types';

export const AdminJoinRequestsModal: React.FC<{
  communityId: string;
  isOpen: boolean;
  onClose: () => void;
}> = ({ communityId, isOpen, onClose }) => {
  const [requests, setRequests] = useState<CommunityJoinRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchQueue = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`/api/communities/${communityId}/join-requests?status=PENDING`);
      setRequests(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchQueue();
  }, [communityId, isOpen]);

  const handleAction = async (requestId: string, action: 'accept' | 'reject') => {
    try {
      await axios.post(`/api/communities/${communityId}/join-requests/${requestId}/${action}`);
      setRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err: any) {
      alert(err.response?.data?.message || `Failed to ${action} request`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
        <div className="flex justify-between items-center border-b pb-3">
          <h3 className="text-lg font-bold">Pending Join Requests</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 font-bold">✕</button>
        </div>

        {loading ? (
          <p className="text-center text-sm text-gray-500 py-6">Loading applicant requests...</p>
        ) : requests.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-6">No pending join requests.</p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {requests.map(req => (
              <div key={req.id} className="p-3 border rounded-xl flex items-center justify-between">
                <div>
                  <h5 className="font-semibold text-sm">{req.user?.name}</h5>
                  <p className="text-xs text-gray-400">{req.user?.email}</p>
                  {req.message && <p className="text-xs italic text-gray-600 mt-1">"{req.message}"</p>}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleAction(req.id, 'accept')}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleAction(req.id, 'reject')}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
```
