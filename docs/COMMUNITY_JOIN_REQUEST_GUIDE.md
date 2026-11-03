# Community Discovery & Join Requests: Frontend Integration Guide

This guide details how frontend clients (**Web, Mobile React Native, and Desktop**) can integrate public community search, discovery, and the join-request workflow (submitting join requests, canceling them, and admin moderation).

---

## 🌟 Overview of Features

1. **Global Community Discovery (`GET /api/communities/search` or `/discover`)**:
   - Allows users to search and explore all communities across Quorum.
   - Automatically computes dynamic `membershipStatus` for the caller:
     - `OWNER`: Caller is the creator/owner of the community.
     - `ADMIN`: Caller has administrative rights.
     - `MEMBER`: Caller is already an active member.
     - `PENDING_REQUEST`: Caller has an open join request awaiting admin approval.
     - `NOT_MEMBER`: Caller has not joined and has no pending request.
   - Includes `pendingRequestId` when `membershipStatus === 'PENDING_REQUEST'`, making cancellation instantaneous without secondary lookups.
   - Supports cursor pagination (`limit`, `cursor`).

2. **Send Join Request (`POST /api/communities/:id/join-requests`)**:
   - Sends a join request with an optional note/message to community administrators.
   - Automatically queues an in-app and push notification for community admins.

3. **User Pending Requests View (`GET /api/communities/join-requests/my`)**:
   - Lists all communities where the user is currently awaiting approval.

4. **Cancel Request (`DELETE /api/communities/:id/join-requests`)**:
   - Allows an applicant to withdraw their pending join request at any time before admin review.

5. **Admin Moderation (`GET`, `POST accept`, `POST reject`)**:
   - Community `OWNER` and `ADMIN` can view applicant queues.
   - Accepting automatically adds the user to the community with role `MEMBER` and notifies the applicant.
   - Rejecting marks the request rejected with an optional reason and notifies the applicant.

---

## 🛠️ API Endpoints Summary

| Method | Endpoint | Description | Auth Required | Access Level |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/api/communities/search?q=...&limit=20` | Discover public communities with caller status | ✅ Required | Any User |
| **GET** | `/api/communities/discover` | Alias for community discovery | ✅ Required | Any User |
| **POST** | `/api/communities/:id/join-requests` | Send join request to community admins | ✅ Required | Non-Members |
| **GET** | `/api/communities/join-requests/my` | View caller's pending join requests | ✅ Required | Any User |
| **DELETE**| `/api/communities/:id/join-requests` | Cancel caller's pending join request | ✅ Required | Applicant |
| **GET** | `/api/communities/:id/join-requests` | List join requests for a community | ✅ Required | Admin / Owner |
| **POST** | `/api/communities/:id/join-requests/:requestId/accept` | Accept applicant into community | ✅ Required | Admin / Owner |
| **POST** | `/api/communities/:id/join-requests/:requestId/reject` | Reject applicant's request | ✅ Required | Admin / Owner |

---

## 📡 Detailed API Specifications

### 1. Discover Communities
**Endpoint:** `GET /api/communities/search` (or `/api/communities/discover`)

#### Query Parameters:
- `q` or `search` *(optional string)*: Search by community name or description.
- `cursor` *(optional string)*: Pagination cursor (ISO timestamp or community ID).
- `limit` *(optional number, default 20)*: Page size (1 to 50).

#### Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "communities": [
      {
        "id": "7a353603-51b6-455b-9d41-e9ff6b3e6962",
        "name": "Fullstack Developers",
        "description": "A place for frontend and backend engineers.",
        "icon": "https://s3.amazonaws.com/quorum/communities/fullstack.png",
        "isPrivate": false,
        "createdAt": "2026-10-15T12:00:00.000Z",
        "memberCount": 142,
        "channelCount": 6,
        "membershipStatus": "NOT_MEMBER",
        "pendingRequestId": null
      },
      {
        "id": "e4a781b2-1321-4f11-9252-c3f253e97f90",
        "name": "AI Engineers & Researchers",
        "description": "Discussing LLMs, Agents, and PyTorch.",
        "icon": null,
        "isPrivate": false,
        "createdAt": "2026-10-20T08:30:00.000Z",
        "memberCount": 89,
        "channelCount": 4,
        "membershipStatus": "PENDING_REQUEST",
        "pendingRequestId": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0"
      }
    ],
    "nextCursor": "2026-10-20T08:30:00.000Z",
    "hasMore": false
  }
}
```

---

### 2. Send Join Request
**Endpoint:** `POST /api/communities/:id/join-requests`

#### Request Body (`application/json`):
```json
{
  "message": "Hi, I am a frontend developer eager to collaborate on Quorum!"
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
    "userId": "93a15264-b001-4475-8f64-dcb41203b879",
    "status": "PENDING",
    "message": "Hi, I am a frontend developer eager to collaborate on Quorum!",
    "createdAt": "2026-11-01T10:00:00.000Z"
  }
}
```

---

### 3. Get User's Pending Join Requests
**Endpoint:** `GET /api/communities/join-requests/my`

#### Response (`200 OK`):
```json
{
  "success": true,
  "data": [
    {
      "id": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
      "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
      "status": "PENDING",
      "message": "Hi, I am a frontend developer eager to collaborate on Quorum!",
      "createdAt": "2026-11-01T10:00:00.000Z",
      "community": {
        "id": "e4a781b2-1321-4f11-9252-c3f253e97f90",
        "name": "AI Engineers & Researchers",
        "description": "Discussing LLMs, Agents, and PyTorch.",
        "icon": null,
        "isPrivate": false
      }
    }
  ]
}
```

---

### 4. Cancel Pending Join Request
**Endpoint:** `DELETE /api/communities/:id/join-requests`

#### Response (`200 OK`):
```json
{
  "success": true,
  "message": "Join request cancelled successfully"
}
```

---

### 5. Community Admin: List Join Requests
**Endpoint:** `GET /api/communities/:id/join-requests?status=PENDING`

#### Query Parameters:
- `status` *(optional, enum: `PENDING`, `ACCEPTED`, `REJECTED`, `CANCELLED`, default `PENDING`)*

#### Response (`200 OK`):
```json
{
  "success": true,
  "data": [
    {
      "id": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
      "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
      "userId": "93a15264-b001-4475-8f64-dcb41203b879",
      "status": "PENDING",
      "message": "Hi, I am a frontend developer eager to collaborate on Quorum!",
      "createdAt": "2026-11-01T10:00:00.000Z",
      "user": {
        "id": "93a15264-b001-4475-8f64-dcb41203b879",
        "name": "Alice Johnson",
        "email": "alice@example.com",
        "avatar": "https://s3.amazonaws.com/quorum/avatars/alice.png"
      }
    }
  ]
}
```

---

### 6. Community Admin: Accept Join Request
**Endpoint:** `POST /api/communities/:id/join-requests/:requestId/accept`

#### Response (`200 OK`):
```json
{
  "success": true,
  "message": "Join request accepted",
  "data": {
    "requestId": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0",
    "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
    "member": {
      "id": "a98124b1-e200-410a-b123-019234857121",
      "userId": "93a15264-b001-4475-8f64-dcb41203b879",
      "communityId": "e4a781b2-1321-4f11-9252-c3f253e97f90",
      "role": "MEMBER"
    }
  }
}
```

---

### 7. Community Admin: Reject Join Request
**Endpoint:** `POST /api/communities/:id/join-requests/:requestId/reject`

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

## 🔔 Real-Time Notifications & Socket.IO Events

When actions occur, Quorum's notification queue automatically pushes in-app notifications and delivers real-time Socket.IO events to affected users:

1. **When a user sends a join request**:
   - Notification created for community **Owner** and **Admins**.
   - Socket room: `user:<adminId>`
   - Payload:
     ```json
     {
       "type": "COMMUNITY_JOIN_REQUEST",
       "title": "New Community Join Request",
       "body": "Alice Johnson requested to join Fullstack Developers",
       "metadata": {
         "communityId": "7a353603-51b6-455b-9d41-e9ff6b3e6962",
         "requestId": "c2b3d8f1-9310-449e-bfa5-91d120a1c1d0"
       }
     }
     ```

2. **When an admin accepts or rejects a join request**:
   - Notification created for applicant user.
   - Socket room: `user:<applicantId>`
   - `type`: `COMMUNITY_JOIN_ACCEPTED` or `COMMUNITY_JOIN_REJECTED`

---

## 💻 Frontend Implementation Examples

### 1. React Web: Community Discovery Card Component

```tsx
import React, { useState } from 'react';
import axios from 'axios';

interface CommunityItem {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  memberCount: number;
  membershipStatus: 'OWNER' | 'ADMIN' | 'MEMBER' | 'PENDING_REQUEST' | 'NOT_MEMBER';
  pendingRequestId?: string | null;
}

export const CommunityCard: React.FC<{
  community: CommunityItem;
  onRefresh: () => void;
}> = ({ community, onRefresh }) => {
  const [loading, setLoading] = useState(false);

  const handleRequestJoin = async () => {
    try {
      setLoading(true);
      await axios.post(`/api/communities/${community.id}/join-requests`, {
        message: 'Excited to join this community!'
      });
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to send join request');
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
    <div className="p-4 border rounded-xl shadow-sm flex items-center justify-between bg-white dark:bg-zinc-900">
      <div className="flex items-center space-x-3">
        {community.icon ? (
          <img src={community.icon} alt={community.name} className="w-12 h-12 rounded-full object-cover" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold">
            {community.name.charAt(0)}
          </div>
        )}
        <div>
          <h3 className="font-semibold text-lg">{community.name}</h3>
          <p className="text-sm text-gray-500 line-clamp-1">{community.description}</p>
          <span className="text-xs text-gray-400">{community.memberCount} members</span>
        </div>
      </div>

      <div>
        {community.membershipStatus === 'MEMBER' || community.membershipStatus === 'OWNER' || community.membershipStatus === 'ADMIN' ? (
          <span className="px-3 py-1.5 bg-green-100 text-green-700 text-sm font-medium rounded-full">
            Joined ({community.membershipStatus})
          </span>
        ) : community.membershipStatus === 'PENDING_REQUEST' ? (
          <button
            onClick={handleCancelRequest}
            disabled={loading}
            className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-sm font-medium rounded-full transition-colors"
          >
            Requested (Cancel)
          </button>
        ) : (
          <button
            onClick={handleRequestJoin}
            disabled={loading}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-full transition-colors"
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

### 2. React Admin: Moderation List Component

```tsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface JoinRequest {
  id: string;
  userId: string;
  message?: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
}

export const CommunityJoinRequestsModal: React.FC<{
  communityId: string;
  isOpen: boolean;
  onClose: () => void;
}> = ({ communityId, isOpen, onClose }) => {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`/api/communities/${communityId}/join-requests?status=PENDING`);
      setRequests(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchRequests();
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-lg w-full space-y-4 shadow-xl">
        <div className="flex justify-between items-center border-b pb-3">
          <h2 className="text-xl font-bold">Pending Join Requests</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 font-bold">✕</button>
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-6">Loading requests...</p>
        ) : requests.length === 0 ? (
          <p className="text-center text-gray-500 py-6">No pending join requests.</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {requests.map(req => (
              <div key={req.id} className="p-3 border rounded-lg flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-sm">{req.user.name} ({req.user.email})</h4>
                  {req.message && <p className="text-xs text-gray-500 italic mt-0.5">"{req.message}"</p>}
                  <span className="text-[10px] text-gray-400">
                    Requested on {new Date(req.createdAt).toLocaleDateString()}
                  </span>
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
