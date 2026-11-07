export const CHAT_EVENTS = {
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_READ: 'message:read',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  PRESENCE_ONLINE: 'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',
  PRESENCE_STATUS_UPDATED: 'presence:status-updated',
  CONVERSATION_JOIN: 'conversation:join',
  CONVERSATION_LEAVE: 'conversation:leave',
  CONVERSATION_UPDATE: 'conversation:update',
  CONVERSATION_REMOVED: 'conversation:removed',
  MESSAGE_EDIT: 'message:edit',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETE: 'message:delete',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_REACT: 'message:react',
  MESSAGE_REACTION_UPDATED: 'message:reaction_updated',
  MESSAGE_GET_REACTIONS: 'message:get-reactions',
  MESSAGE_FORWARD: 'message:forward',
  MESSAGE_FORWARDED: 'message:forwarded',
  POLL_VOTE: 'poll:vote',
  POLL_UPDATED: 'poll:updated'
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

export const PROJECT_EVENTS = {
  PROJECT_UPDATED: 'project:updated',
  PROJECT_MEMBER_JOINED: 'project:member_joined',
  PROJECT_MEMBER_REMOVED: 'project:member_removed',
  TASK_CREATED: 'project:task_created',
  TASK_UPDATED: 'project:task_updated',
  TASK_STATUS_CHANGED: 'project:task_status_changed',
  DELIVERABLE_SUBMITTED: 'project:deliverable_submitted',
  DELIVERABLE_REVIEWED: 'project:deliverable_reviewed',
} as const;

export const OFFICE_EVENTS = {
  JOIN: 'office:join',
  LEAVE: 'office:leave',
  CHANGE_ZONE: 'office:change-zone',
  ZONE_CHANGED: 'office:zone-changed',
  KNOCK: 'office:knock',
  KNOCKED: 'office:knocked',
  USER_JOINED: 'office:user-joined',
  USER_LEFT: 'office:user-left',
  STATE_UPDATED: 'office:state-updated',
  MEETING_STARTED: 'office:meeting-started',
  MEETING_ENDED: 'office:meeting-ended',
} as const;

export const DOCUMENT_EVENTS = {
  DOCUMENT_JOIN: 'document:join',
  DOCUMENT_LEAVE: 'document:leave',
  DOCUMENT_USER_JOINED: 'document:user_joined',
  DOCUMENT_USER_LEFT: 'document:user_left',
  DOCUMENT_USERS_LIST: 'document:users_list',
  DOCUMENT_UPDATE: 'document:update',
  DOCUMENT_UPDATED: 'document:updated',
  DOCUMENT_CURSOR: 'document:cursor',
  DOCUMENT_CURSOR_MOVED: 'document:cursor_moved',
  DOCUMENT_SAVED: 'document:saved',
  WHITEBOARD_EMBEDDED: 'document:whiteboard_embedded',
  MEETING_DOCUMENT_OPENED: 'meeting:document_opened',
  MEETING_DOCUMENT_CLOSED: 'meeting:document_closed'
} as const;
