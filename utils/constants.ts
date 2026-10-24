export const CHAT_EVENTS = {
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_READ: 'message:read',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  PRESENCE_ONLINE: 'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',
  CONVERSATION_JOIN: 'conversation:join',
  CONVERSATION_LEAVE: 'conversation:leave',
  CONVERSATION_UPDATE: 'conversation:update',
  CONVERSATION_REMOVED: 'conversation:removed',
  MESSAGE_EDIT: 'message:edit',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETE: 'message:delete',
  MESSAGE_DELETED: 'message:deleted'
} as const;

export const COMMUNITY_EVENTS = {
  COMMUNITY_JOIN: 'community:join',
  COMMUNITY_LEAVE: 'community:leave',
  CHANNEL_JOIN: 'community:channel:join',
  CHANNEL_LEAVE: 'community:channel:leave',
  POST_ROOM_JOIN: 'community:post:join',
  POST_ROOM_LEAVE: 'community:post:leave',
  POST_NEW: 'community:post:new',
  POST_UPDATED: 'community:post:updated',
  POST_DELETED: 'community:post:deleted',
  COMMENT_NEW: 'community:comment:new',
  COMMENT_DELETED: 'community:comment:deleted'
} as const;
