# Frontend Integration Guide: Profile & Community Join Requests

This document is the official handover guide for the **Frontend Team (Web, React Native / Mobile, and Desktop)**. It outlines all newly added and updated backend endpoints, payloads, response shapes, and real-time Socket.IO events.

---

## 📋 Table of Contents
1. [Summary of New Features](#-summary-of-new-features)
2. [Section 1: User Profile & Direct Avatar Photo Upload](#-section-1-user-profile--direct-avatar-photo-upload)
3. [Section 2: Public Community Discovery](#-section-2-public-community-discovery)
4. [Section 3: Community Join Requests & Admin Moderation](#-section-3-community-join-requests--admin-moderation)
5. [Section 4: Real-Time Socket.IO Events](#-section-4-real-time-socketio-events)
6. [Section 5: TypeScript Models & Interfaces](#-section-5-typescript-models--interfaces)
7. [Section 6: Ready-to-Use Frontend Code Examples](#-section-6-ready-to-use-frontend-code-examples)

---

## 🌟 Summary of New Features

| Feature | Description | Target Clients |
| :--- | :--- | :--- |
| **Direct Avatar Upload** | Direct `multipart/form-data` photo upload. Automatically stores to AWS S3 (`uploads/avatars/`) and updates DB in a single request. | Web & Mobile |
| **User Profile Management** | `GET`, `PATCH`, `PUT /api/users/profile` for updating display name, avatar, use-cases, and onboarding status. | Web & Mobile |
| **Global Community Search** | Search all platform communities with dynamic caller status (`OWNER`, `ADMIN`, `MEMBER`, `PENDING_REQUEST`, `NOT_MEMBER`). | Web & Mobile |
| **Join Request Workflow** | Users can send join requests to community admins, view pending requests, or cancel them before approval. | Web & Mobile |
| **Admin Moderation** | Community Owners and Admins can view pending applicant queues, accept (auto-adds member), or reject with reason. | Web & Mobile |

---

## 👤 Section 1: User Profile & Direct Avatar Photo Upload

### 1.1 Endpoints Overview

| Method | Endpoint | Supported Content-Type | Purpose |
| :--- | :--- | :--- | :--- |
| **GET** | `/api/users/profile` | `application/json` | Fetch full profile of authenticated user |
| **PATCH** | `/api/users/profile` | `multipart/form-data` OR `application/json` | Partial update (name, useCases, avatar file/URL) |
| **PUT** | `/api/users/profile` | `multipart/form-data` OR `application/json` | Full update / set profile fields |
| **GET** | `/api/auth/me` | `application/json` | Hydrate active user session (includes avatar & useCases) |

> **Aliases**: The profile endpoint is also available under `/api/v1/users/profile` and `/api/user/profile`.

---

### 1.2 Direct Avatar Upload (`multipart/form-data`)

Use this when the user chooses a photo from their file picker, camera, or device photo gallery. **No separate upload step is required.**

- **Accepted file field names**: `avatar` (recommended), `file`, or `image`.
- **Supported file formats**: `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.gif`.
- **Max file size**: `10 MB`.
- **Optional accompanying text fields**: `name`, `useCases`, `isOnboarded`.

#### Example Request (Web FormData):
```typescript
const formData = new FormData();
formData.append('avatar', selectedFile); // File or Blob
formData.append('name', 'Alex Mercer');
formData.append('useCases', JSON.stringify(['STUDY', 'WORK'])); // Or comma-separated

await axios.patch('/api/users/profile', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
  withCredentials: true,
});
```

#### Example Request (Mobile React Native / Expo):
```typescript
const formData = new FormData();
formData.append('avatar', {
  uri: asset.uri,
  name: asset.fileName || 'avatar.jpg',
  type: asset.mimeType || 'image/jpeg',
} as any);
formData.append('name', 'Alex Mercer');

await axios.patch('/api/users/profile', formData, {
  headers: {
    'Content-Type': 'multipart/form-data',
    'x-client-platform': 'mobile',
    Authorization: `Bearer ${accessToken}`,
  },
});
```

#### Successful Response (`200 OK`):
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "user": {
      "id": "6d57bac9-f1b6-4b19-9ab6-0c7997a8eb46",
      "name": "Alex Mercer",
      "email": "alex@example.com",
      "avatar": "https://quorum-storage.s3.amazonaws.com/uploads/avatars/6d57bac9-...-avatar.jpg",
      "role": "USER",
      "isOnboarded": true,
      "useCases": ["STUDY", "WORK"],
      "createdAt": "2026-10-15T08:00:00.000Z",
      "updatedAt": "2026-11-01T14:00:00.000Z"
    }
  }
}
```

---

### 1.3 JSON Profile Update (`application/json`)

If the user is only updating text information (e.g. changing their name or selecting use cases without changing the picture):

```http
PATCH /api/users/profile HTTP/1.1
Content-Type: application/json
Authorization: Bearer <token>

{
  "name": "Alex Mercer",
  "useCases": ["DEVELOPMENT", "RESEARCH"],
  "isOnboarded": true
}
```

---

## 🔍 Section 2: Public Community Discovery

### 2.1 Search Public Communities
**Endpoint:** `GET /api/communities/search` (or `GET /api/communities/discover`)

Enables users to explore communities across the platform. The backend automatically calculates and returns the authenticated user's exact membership state.

#### Query Parameters:
| Param | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `q` or `search` | `string` | No | Search query matching community name or description |
| `limit` | `number` | No | Number of results (default `20`, max `50`) |
| `cursor` | `string` | No | Pagination cursor (returned as `nextCursor` from previous page) |

#### Caller Membership Statuses:
- `NOT_MEMBER`: User has not joined and has no pending join request.
- `PENDING_REQUEST`: User has an active join request awaiting admin approval. `pendingRequestId` is populated.
- `MEMBER`: User is an active member.
- `ADMIN`: User is a community administrator.
- `OWNER`: User is the community owner.

#### Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "communities": [
      {
        "id": "74592439-080e-4d72-a60c-3c23300d9f2f",
        "name": "Fullstack Developers",
        "description": "Collaborate on modern web and mobile apps.",
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
        "description": "LLMs, Agents, and Deep Learning discussions.",
        "icon": null,
        "createdAt": "2026-10-25T14:30:00.000Z",
        "memberCount": 88,
        "channelCount": 4,
        "membershipStatus": "PENDING_REQUEST",
        "pendingRequestId": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0"
      }
    ],
    "nextCursor": "2026-10-25T14:30:00.000Z",
    "hasMore": false
  }
}
```

---

## 🤝 Section 3: Community Join Requests & Admin Moderation

### 3.1 Send a Join Request
**Endpoint:** `POST /api/communities/:id/join-requests`

Submits a join request to community administrators.
- **Request Body**:
  ```json
  {
    "message": "Hi! Excited to join and contribute."
  }
  ```
  *(Note: `message` is optional, max 500 characters).*
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Join request sent successfully",
    "data": {
      "id": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
      "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
      "userId": "984aaa79-1a9f-4896-941b-8a3a44171f1b",
      "status": "PENDING",
      "message": "Hi! Excited to join and contribute.",
      "createdAt": "2026-11-01T10:00:00.000Z"
    }
  }
  ```

---

### 3.2 View My Pending Join Requests
**Endpoint:** `GET /api/communities/join-requests/my` (or `/join-requests/pending`)

Returns all communities where the user is currently awaiting review.
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
        "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
        "status": "PENDING",
        "message": "Hi! Excited to join and contribute.",
        "createdAt": "2026-11-01T10:00:00.000Z",
        "community": {
          "id": "e4a781b2-1321-4f11-9252-c3f253e97f90",
          "name": "AI Engineers",
          "description": "LLMs, Agents, and Deep Learning discussions."
        }
      }
    ]
  }
  ```

---

### 3.3 Cancel a Pending Join Request
**Endpoint:** `DELETE /api/communities/:id/join-requests`

Allows an applicant to withdraw their pending join request at any time before admin review.
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Join request cancelled successfully"
  }
  ```

---

### 3.4 Community Admin: View Pending Join Requests
**Endpoint:** `GET /api/communities/:id/join-requests?status=PENDING`
- **Access Level**: `OWNER` or `ADMIN` only (others receive `403 Forbidden`).
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
        "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
        "userId": "984aaa79-1a9f-4896-941b-8a3a44171f1b",
        "status": "PENDING",
        "message": "Hi! Excited to join and contribute.",
        "createdAt": "2026-11-01T10:00:00.000Z",
        "user": {
          "id": "984aaa79-1a9f-4896-941b-8a3a44171f1b",
          "name": "Alice Johnson",
          "email": "alice@example.com",
          "avatar": "https://quorum-storage.s3.amazonaws.com/uploads/avatars/alice.png"
        }
      }
    ]
  }
  ```

---

### 3.5 Community Admin: Accept a Join Request
**Endpoint:** `POST /api/communities/:id/join-requests/:requestId/accept`
- **Access Level**: `OWNER` or `ADMIN` only.
- **Behavior**: Marks request `ACCEPTED`, automatically creates a `CommunityMember` record with role `MEMBER`, and pushes real-time notification to the applicant.
- **Response (`200 OK`)**:
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

### 3.6 Community Admin: Reject a Join Request
**Endpoint:** `POST /api/communities/:id/join-requests/:requestId/reject`
- **Access Level**: `OWNER` or `ADMIN` only.
- **Request Body**:
  ```json
  {
    "reason": "Profile prerequisites not satisfied."
  }
  ```
  *(Note: `reason` is optional, max 500 characters).*
- **Response (`200 OK`)**:
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

## 🔔 Section 4: Real-Time Socket.IO Events

The backend automatically dispatches real-time Socket.IO notifications to user-specific rooms (`user:<userId>`). Listen to `notification:new` on your Socket.IO client:

```typescript
socket.on('notification:new', (notification) => {
  switch (notification.type) {
    case 'COMMUNITY_JOIN_REQUEST':
      // Admin received a new applicant request
      console.log('New join request:', notification.body);
      break;

    case 'COMMUNITY_JOIN_ACCEPTED':
      // Applicant's request was accepted
      console.log('You were accepted into:', notification.body);
      // Trigger navigation or refetch joined communities
      break;

    case 'COMMUNITY_JOIN_REJECTED':
      // Applicant's request was rejected
      console.log('Join request was rejected:', notification.body);
      break;
  }
});
```

---

## 📐 Section 5: TypeScript Models & Interfaces

Copy and paste these interfaces into your frontend project:

```typescript
export type MembershipStatus =
  | 'OWNER'
  | 'ADMIN'
  | 'MEMBER'
  | 'PENDING_REQUEST'
  | 'NOT_MEMBER';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  isOnboarded: boolean;
  useCases: string[];
  createdAt: string;
  updatedAt: string;
}

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
  };
}
```

---

## 💻 Section 6: Ready-to-Use Frontend Code Examples

### 6.1 React Web: Community Discovery Card

```tsx
import React, { useState } from 'react';
import axios from 'axios';
import { DiscoveredCommunity } from './types';

export const CommunityCard: React.FC<{
  community: DiscoveredCommunity;
  onStatusChange: () => void;
}> = ({ community, onStatusChange }) => {
  const [loading, setLoading] = useState(false);

  const requestToJoin = async () => {
    try {
      setLoading(true);
      await axios.post(`/api/communities/${community.id}/join-requests`, {
        message: 'Hello! I would love to collaborate in this community.',
      });
      onStatusChange();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to send request');
    } finally {
      setLoading(false);
    }
  };

  const cancelRequest = async () => {
    try {
      setLoading(true);
      await axios.delete(`/api/communities/${community.id}/join-requests`);
      onStatusChange();
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
            onClick={cancelRequest}
            disabled={loading}
            className="px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-semibold rounded-full transition"
          >
            Requested (Cancel)
          </button>
        ) : (
          <button
            onClick={requestToJoin}
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

### 6.2 React Admin: Applicant Moderation Panel

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
          <h3 className="text-lg font-bold">Community Join Requests</h3>
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
