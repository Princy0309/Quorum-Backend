import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import prisma from '../../config/prisma.js';
import { COMMUNITY_EVENTS } from '../../utils/constants.js';
import logger from '../../utils/logger.js';

interface SocketCallbackResponse<T = any> {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;
  data?: T;
}

const formatErrorResponse = (code: string, message: string): SocketCallbackResponse => ({
  success: false,
  code,
  message,
  error: message
});

export const registerCommunityHandler = (io: SocketIOServer, socket: AuthenticatedSocket) => {
  socket.on(
    COMMUNITY_EVENTS.COMMUNITY_JOIN,
    async (
      payload: { communityId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        const { communityId } = payload || {};
        if (!communityId) {
          if (callback) callback(formatErrorResponse('VALIDATION_ERROR', 'communityId is required'));
          return;
        }

        const membership = await prisma.communityMember.findUnique({
          where: {
            communityId_userId: {
              communityId,
              userId
            }
          }
        });

        if (!membership) {
          if (callback) callback(formatErrorResponse('FORBIDDEN', 'You are not a member of this community'));
          return;
        }

        socket.join(`community:${communityId}`);
        if (callback) callback({ success: true, message: `Joined community room community:${communityId}` });
      } catch (err: any) {
        logger.error('Error joining community room', { error: err.message });
        if (callback) callback(formatErrorResponse('SERVER_ERROR', 'Internal server error'));
      }
    }
  );

  socket.on(
    COMMUNITY_EVENTS.COMMUNITY_LEAVE,
    (
      payload: { communityId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const { communityId } = payload || {};
        if (communityId) {
          socket.leave(`community:${communityId}`);
        }
        if (callback) callback({ success: true });
      } catch (err: any) {
        if (callback) callback(formatErrorResponse('SERVER_ERROR', 'Internal server error'));
      }
    }
  );

  socket.on(
    COMMUNITY_EVENTS.CHANNEL_JOIN,
    async (
      payload: { channelId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        const { channelId } = payload || {};
        if (!channelId) {
          if (callback) callback(formatErrorResponse('VALIDATION_ERROR', 'channelId is required'));
          return;
        }

        const channel = await prisma.communityChannel.findUnique({
          where: { id: channelId },
          select: { id: true, communityId: true }
        });

        if (!channel) {
          if (callback) callback(formatErrorResponse('NOT_FOUND', 'Channel not found'));
          return;
        }

        const membership = await prisma.communityMember.findUnique({
          where: {
            communityId_userId: {
              communityId: channel.communityId,
              userId
            }
          }
        });

        if (!membership) {
          if (callback) callback(formatErrorResponse('FORBIDDEN', 'You are not a member of this community'));
          return;
        }

        socket.join(`community:channel:${channelId}`);
        if (callback) callback({ success: true, message: `Joined channel room community:channel:${channelId}` });
      } catch (err: any) {
        logger.error('Error joining channel room', { error: err.message });
        if (callback) callback(formatErrorResponse('SERVER_ERROR', 'Internal server error'));
      }
    }
  );

  socket.on(
    COMMUNITY_EVENTS.CHANNEL_LEAVE,
    (
      payload: { channelId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const { channelId } = payload || {};
        if (channelId) {
          socket.leave(`community:channel:${channelId}`);
        }
        if (callback) callback({ success: true });
      } catch (err: any) {
        if (callback) callback(formatErrorResponse('SERVER_ERROR', 'Internal server error'));
      }
    }
  );

  socket.on(
    COMMUNITY_EVENTS.POST_ROOM_JOIN,
    async (
      payload: { postId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        const { postId } = payload || {};
        if (!postId) {
          if (callback) callback(formatErrorResponse('VALIDATION_ERROR', 'postId is required'));
          return;
        }

        const post = await prisma.communityPost.findUnique({
          where: { id: postId },
          select: { id: true, communityId: true }
        });

        if (!post) {
          if (callback) callback(formatErrorResponse('NOT_FOUND', 'Post not found'));
          return;
        }

        const membership = await prisma.communityMember.findUnique({
          where: {
            communityId_userId: {
              communityId: post.communityId,
              userId
            }
          }
        });

        if (!membership) {
          if (callback) callback(formatErrorResponse('FORBIDDEN', 'You are not a member of this community'));
          return;
        }

        socket.join(`community:post:${postId}`);
        if (callback) callback({ success: true, message: `Joined post room community:post:${postId}` });
      } catch (err: any) {
        logger.error('Error joining post room', { error: err.message });
        if (callback) callback(formatErrorResponse('SERVER_ERROR', 'Internal server error'));
      }
    }
  );

  socket.on(
    COMMUNITY_EVENTS.POST_ROOM_LEAVE,
    (
      payload: { postId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const { postId } = payload || {};
        if (postId) {
          socket.leave(`community:post:${postId}`);
        }
        if (callback) callback({ success: true });
      } catch (err: any) {
        if (callback) callback(formatErrorResponse('SERVER_ERROR', 'Internal server error'));
      }
    }
  );
};
