# Whiteboard Collaboration & Meeting Integration Guide

## 1. Overview
Whiteboards in Quorum belong permanently to an **Organisation** and can be opened directly inside **Meetings**.
Both the Organisation dashboard and live Meetings share the exact same backend model, data store, and `boardId`. Any modifications made inside a meeting are automatically persistent and immediately accessible in the organisation afterward.

---

## 2. Key Architecture Principles

1. **Single Whiteboard Model**: Stored in PostgreSQL with a vector element canvas model (`Json`).
2. **Organisation Home**: Every whiteboard belongs to an `organizationId`.
3. **Meeting Collaboration**:
   - When a meeting opens a whiteboard, the backend verifies that **both the meeting and the whiteboard belong to the exact same organization**.
   - Multiple meetings can reference the same whiteboard over time via `WhiteboardMeeting`.
4. **Real-time Vector Sync**:
   - Clients send lightweight element deltas (`whiteboard:draw-element`, `whiteboard:elements-change`) instead of heavy bitmap images.
   - Server debounces persistence (2.5 seconds) to avoid database spam while ensuring 100% data durability.

---

## 3. Data Format

### Whiteboard Model Fields
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `UUID` | Unique identifier for the board |
| `organizationId` | `UUID` | Owning organisation |
| `name` | `String` | Human-readable board name (e.g., "Sprint Planning") |
| `content` | `JSON` | Saved vector elements and view state |
| `createdById` | `UUID` | User who created the board |
| `meetingId` | `UUID?` | Optional origin meeting if created during a meeting |
| `createdAt` | `DateTime`| Creation timestamp |
| `updatedAt` | `DateTime`| Last modification timestamp |

### Canvas `content` Payload Structure
```json
{
  "elements": [
    {
      "id": "el_12345",
      "type": "stroke",
      "points": [[120, 150], [125, 155], [130, 160]],
      "strokeColor": "#3b82f6",
      "strokeWidth": 3
    },
    {
      "id": "el_67890",
      "type": "text",
      "x": 200,
      "y": 100,
      "text": "Sprint Goals: Architecture & Real-Time Sync",
      "fontSize": 18,
      "color": "#0f172a"
    },
    {
      "id": "el_sticky_1",
      "type": "stickyNote",
      "x": 400,
      "y": 200,
      "width": 160,
      "height": 160,
      "backgroundColor": "#fef08a",
      "text": "Need to test on mobile viewport"
    }
  ],
  "viewState": {
    "zoom": 1,
    "scrollX": 0,
    "scrollY": 0,
    "backgroundColor": "#ffffff"
  }
}
```

---

## 4. REST API Reference

All requests require JWT Bearer token authentication in the `Authorization` header or cookie.

### 4.1 Organization Whiteboards

#### Create Whiteboard
`POST /api/whiteboards`
```json
{
  "name": "Sprint 42 Architecture",
  "organizationId": "6b3f71c2-3e2b-4228-971c-5d9ea4c51bb9",
  "content": {
    "elements": [],
    "viewState": { "zoom": 1, "scrollX": 0, "scrollY": 0 }
  }
}
```

#### List Organization Whiteboards
`GET /api/whiteboards?organizationId=6b3f71c2-3e2b-4228-971c-5d9ea4c51bb9&page=1&limit=20&search=Sprint`

#### Get Single Whiteboard
`GET /api/whiteboards/:id`
Returns the whiteboard, full `content` JSON, creator details, and all linked meeting history.

#### Update Whiteboard Name or Content
`PATCH /api/whiteboards/:id`
```json
{
  "name": "Sprint 42 Architecture (Final)",
  "content": {
    "elements": [...],
    "viewState": { ... }
  }
}
```

#### Delete Whiteboard
`DELETE /api/whiteboards/:id`
*Allowed only for the board creator, organisation admin, or organisation owner.*

---

### 4.2 Meeting Whiteboard Integration

#### List Whiteboards for a Meeting
`GET /api/meetings/:code/whiteboards`
Returns all whiteboards linked to the specified meeting code (e.g., `abc-def-ghi`).

#### Create a New Whiteboard inside a Meeting
`POST /api/meetings/:code/whiteboards`
```json
{
  "name": "Ad-hoc Brainstorming",
  "content": {}
}
```
*Creates the board under the meeting's organisation and automatically links it to the meeting with the same `boardId`.*

#### Open an Existing Organization Whiteboard inside a Meeting
`POST /api/meetings/:code/whiteboards/:whiteboardId/open`
- Verifies user belongs to the organisation.
- **Enforces**: Meeting and whiteboard must belong to the same organisation.
- Returns the complete whiteboard state and the Socket.IO room name:
```json
{
  "success": true,
  "message": "Whiteboard opened in meeting successfully",
  "data": {
    "whiteboard": { ... },
    "meeting": { "id": "...", "code": "abc-def-ghi" },
    "socketRoom": "whiteboard:8e9a2240-f657-410a-8d19-4876b5b597cd"
  }
}
```

---

## 5. Real-Time Socket.IO Protocol

Socket endpoint: `/socket.io/` (with auth token provided via `auth: { token }` or headers).

### Events Quick Reference

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `whiteboard:join` | Client -> Server | `{ boardId, meetingCode? }` | Joins room, returns full initial elements |
| `whiteboard:user-joined` | Server -> Room | `{ socketId, user }` | Informs peers of a new collaborator |
| `whiteboard:draw-element` | Client -> Server | `{ boardId, element }` | Sends newly drawn stroke/shape/text |
| `whiteboard:element-updated` | Server -> Room | `{ element, updatedBy }` | Broadcasts single element modification |
| `whiteboard:elements-change` | Client -> Server | `{ boardId, updates, deletes }` | Bulk updates or deletions |
| `whiteboard:elements-changed` | Server -> Room | `{ updates, deletes, updatedBy }` | Broadcasts bulk changes |
| `whiteboard:cursor-move` | Client -> Server | `{ boardId, x, y }` | Ephemeral live cursor coordinate |
| `whiteboard:cursor-moved` | Server -> Room | `{ socketId, userId, name, x, y }` | Renders collaborator cursors |
| `whiteboard:clear` | Client -> Server | `{ boardId }` | Clears canvas elements |
| `whiteboard:cleared` | Server -> Room | `{ clearedBy }` | Notifies peers to clear canvas |
| `whiteboard:leave` | Client -> Server | `{ boardId }` | Leaves room, triggers auto-flush |
| `whiteboard:user-left` | Server -> Room | `{ socketId, userId }` | Notifies peers collaborator left |

---

## 6. Frontend Integration Example (React / Vue / Vanilla JS)

```javascript
import { io } from 'socket.io-client';

const socket = io('https://api.newquorum.me', {
  auth: { token: localStorage.getItem('accessToken') },
  withCredentials: true,
});

// 1. Join whiteboard session
socket.emit('whiteboard:join', { boardId: '8e9a2240...', meetingCode: 'abc-def-ghi' }, (response) => {
  if (response.success) {
    const { elements, viewState, activeUsers } = response.data;
    renderCanvasElements(elements);
    updatePeerPresence(activeUsers);
  } else {
    alert(response.message);
  }
});

// 2. Broadcast when drawing freehand or typing text
function onUserDraw(newElement) {
  socket.emit('whiteboard:draw-element', {
    boardId: currentBoardId,
    element: newElement, // { id, type, points, strokeColor, ... }
  });
}

// 3. Receive updates from other collaborators
socket.on('whiteboard:element-updated', ({ element }) => {
  applyRemoteElement(element);
});

// 4. Multi-user cursor tracking
window.addEventListener('mousemove', (e) => {
  socket.emit('whiteboard:cursor-move', {
    boardId: currentBoardId,
    x: e.clientX,
    y: e.clientY,
  });
});

socket.on('whiteboard:cursor-moved', ({ userId, name, x, y }) => {
  updateCollaboratorCursor(userId, name, x, y);
});
```
