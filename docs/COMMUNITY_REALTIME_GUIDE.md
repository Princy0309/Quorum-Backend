# Community Real-Time WebSockets — Frontend Integration Guide

This guide describes how to listen for real-time **community posts** and **comments** over Socket.IO so users see new posts, post updates, deletes, and comments appear dynamically without refreshing.

---

## 1. Connecting & Rooms

The frontend establishes a Socket.IO connection using your standard credentials/JWT auth.

### 1.1 Community Feed Rooms
When entering a community screen or specific channel, join the corresponding room:
```javascript
// When entering a community view:
socket.emit('community:join', { communityId: 'COMMUNITY_ID' }, (response) => {
  if (response.success) console.log('Listening to community live updates');
});

// When leaving the community view:
socket.emit('community:leave', { communityId: 'COMMUNITY_ID' });

// When entering a specific channel:
socket.emit('community:channel:join', { channelId: 'CHANNEL_ID' });

// When leaving that channel:
socket.emit('community:channel:leave', { channelId: 'CHANNEL_ID' });
```
*(Note: As a member of a community, you will also receive `community:post:new` on your user room `user:{userId}` automatically).*

---

### 1.2 Post Comments Room
When a user opens a post modal or navigates to the post details/comments screen, join the post room:
```javascript
// When opening post details:
socket.emit('community:post:join', { postId: 'POST_ID' }, (response) => {
  if (response.success) console.log('Listening for live comments under this post');
});

// When closing post details:
socket.emit('community:post:leave', { postId: 'POST_ID' });
```

---

## 2. Event Subscriptions (Frontend Listeners)

### 2.1 New Post Created (`community:post:new`)
Emitted whenever any member submits a post in the community or channel.

```javascript
socket.on('community:post:new', ({ post }) => {
  // 1. If currently viewing this community/channel, prepend post to the feed list
  setPosts((prevPosts) => {
    // Prevent duplicate entries if the author is this user
    if (prevPosts.some((p) => p.id === post.id)) return prevPosts;
    return [post, ...prevPosts];
  });
});
```

**Payload Example:**
```json
{
  "post": {
    "id": "18cf3291-7f93-4a69-89ea-3fe33c8b671a",
    "communityId": "...",
    "channelId": "...",
    "content": "Excited to share our new update!",
    "fileUrl": null,
    "createdAt": "2026-10-23T11:30:00.000Z",
    "author": {
      "id": "...",
      "name": "Jane Doe",
      "avatar": "https://..."
    },
    "channel": {
      "id": "...",
      "name": "general",
      "isDefault": true
    },
    "_count": {
      "comments": 0
    }
  }
}
```

---

### 2.2 Post Updated (`community:post:updated`)
Emitted when a post's content or attachment is edited.

```javascript
socket.on('community:post:updated', ({ post }) => {
  setPosts((prevPosts) =>
    prevPosts.map((p) => (p.id === post.id ? { ...p, ...post } : p))
  );
});
```

---

### 2.3 Post Deleted (`community:post:deleted`)
Emitted when a post is removed by its author or a community admin/owner.

```javascript
socket.on('community:post:deleted', ({ postId, channelId, communityId }) => {
  setPosts((prevPosts) => prevPosts.filter((p) => p.id !== postId));
});
```

---

### 2.4 New Comment Created (`community:comment:new`)
Emitted when someone comments on a post. Emitted to both `community:post:{postId}` and `community:{communityId}` (so feed cards can update comment counts).

```javascript
socket.on('community:comment:new', ({ comment, postId, communityId }) => {
  // If post details is open for this postId:
  if (currentPostId === postId) {
    setComments((prevComments) => {
      if (prevComments.some((c) => c.id === comment.id)) return prevComments;
      return [...prevComments, comment];
    });
  }

  // Update comment counter badge in community feed:
  setPosts((prevPosts) =>
    prevPosts.map((p) => {
      if (p.id === postId) {
        return {
          ...p,
          _count: {
            ...p._count,
            comments: (p._count?.comments || 0) + 1
          }
        };
      }
      return p;
    })
  );
});
```

**Payload Example:**
```json
{
  "postId": "18cf3291-7f93-4a69-89ea-3fe33c8b671a",
  "communityId": "...",
  "comment": {
    "id": "90ea141b-4fc6-4078-a902-60195a6ad6e3",
    "postId": "18cf3291-7f93-4a69-89ea-3fe33c8b671a",
    "content": "Looking great!",
    "createdAt": "2026-10-23T11:31:00.000Z",
    "author": {
      "id": "...",
      "name": "Alex Smith",
      "avatar": "https://..."
    }
  }
}
```

---

### 2.5 Comment Deleted (`community:comment:deleted`)
Emitted when a comment is removed.

```javascript
socket.on('community:comment:deleted', ({ commentId, postId, communityId }) => {
  if (currentPostId === postId) {
    setComments((prevComments) => prevComments.filter((c) => c.id !== commentId));
  }

  // Decrement comment counter badge in feed:
  setPosts((prevPosts) =>
    prevPosts.map((p) => {
      if (p.id === postId) {
        return {
          ...p,
          _count: {
            ...p._count,
            comments: Math.max((p._count?.comments || 1) - 1, 0)
          }
        };
      }
      return p;
    })
  );
});
```
