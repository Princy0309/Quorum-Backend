import { Server, Socket } from 'socket.io';
import prisma from '../../config/prisma.js';
import redis from '../../config/redis.js';
import logger from '../../utils/logger.js';
import { DOCUMENT_EVENTS } from '../../utils/constants.js';

interface DocumentUser {
  userId: string;
  name: string;
  email?: string;
  avatar?: string;
  socketId: string;
}

const socketDocMap = new Map<string, Set<string>>();
const docUsersMap = new Map<string, Map<string, DocumentUser>>();

export const registerDocumentHandler = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  socket.on(DOCUMENT_EVENTS.DOCUMENT_JOIN, async (data: { documentId: string }, ack?: (res: any) => void) => {
    try {
      const documentId = data?.documentId;
      if (!documentId) {
        ack?.({ success: false, message: 'Document ID is required' });
        return;
      }

      const room = `document:${documentId}`;
      socket.join(room);

      if (!socketDocMap.has(socket.id)) {
        socketDocMap.set(socket.id, new Set());
      }
      socketDocMap.get(socket.id)!.add(documentId);

      const userInfo: DocumentUser = {
        userId: user?.id || socket.id,
        name: user?.name || 'Anonymous User',
        email: user?.email,
        avatar: user?.avatar,
        socketId: socket.id
      };

      if (!docUsersMap.has(documentId)) {
        docUsersMap.set(documentId, new Map());
      }
      docUsersMap.get(documentId)!.set(socket.id, userInfo);

      const activeUsers = Array.from(docUsersMap.get(documentId)!.values());

      socket.to(room).emit(DOCUMENT_EVENTS.DOCUMENT_USER_JOINED, userInfo);
      socket.emit(DOCUMENT_EVENTS.DOCUMENT_USERS_LIST, { documentId, users: activeUsers });

      ack?.({ success: true, activeUsers });
    } catch (err: any) {
      logger.error(`[DocumentSocket] Join error: ${err.message}`);
      ack?.({ success: false, message: err.message });
    }
  });

  socket.on(DOCUMENT_EVENTS.DOCUMENT_LEAVE, (data: { documentId: string }, ack?: (res: any) => void) => {
    try {
      const documentId = data?.documentId;
      if (!documentId) {
        ack?.({ success: false, message: 'Document ID is required' });
        return;
      }

      const room = `document:${documentId}`;
      socket.leave(room);

      if (socketDocMap.has(socket.id)) {
        socketDocMap.get(socket.id)!.delete(documentId);
      }

      if (docUsersMap.has(documentId)) {
        docUsersMap.get(documentId)!.delete(socket.id);
        if (docUsersMap.get(documentId)!.size === 0) {
          docUsersMap.delete(documentId);
        }
      }

      socket.to(room).emit(DOCUMENT_EVENTS.DOCUMENT_USER_LEFT, {
        documentId,
        userId: user?.id || socket.id,
        socketId: socket.id
      });

      ack?.({ success: true });
    } catch (err: any) {
      logger.error(`[DocumentSocket] Leave error: ${err.message}`);
      ack?.({ success: false, message: err.message });
    }
  });

  socket.on(DOCUMENT_EVENTS.DOCUMENT_UPDATE, async (data: {
    documentId: string;
    content?: any;
    delta?: any;
    version?: number;
    title?: string;
  }, ack?: (res: any) => void) => {
    try {
      const { documentId, content, delta, version, title } = data || {};
      if (!documentId) {
        ack?.({ success: false, message: 'Document ID is required' });
        return;
      }

      const room = `document:${documentId}`;

      socket.to(room).emit(DOCUMENT_EVENTS.DOCUMENT_UPDATED, {
        documentId,
        content,
        delta,
        version,
        title,
        updatedBy: {
          id: user?.id || socket.id,
          name: user?.name || 'Anonymous User'
        },
        timestamp: new Date().toISOString()
      });

      if (content !== undefined || title !== undefined) {
        prisma.document.update({
          where: { id: documentId },
          data: {
            ...(content !== undefined ? { content } : {}),
            ...(title !== undefined ? { title } : {}),
            updatedAt: new Date()
          }
        }).catch((dbErr: any) => {
          logger.error(`[DocumentSocket] Async save error for doc ${documentId}: ${dbErr.message}`);
        });
      }

      ack?.({ success: true });
    } catch (err: any) {
      logger.error(`[DocumentSocket] Update error: ${err.message}`);
      ack?.({ success: false, message: err.message });
    }
  });

  socket.on(DOCUMENT_EVENTS.DOCUMENT_CURSOR, (data: {
    documentId: string;
    cursor: { line: number; ch: number; selection?: any };
  }) => {
    const { documentId, cursor } = data || {};
    if (!documentId || !cursor) return;

    const room = `document:${documentId}`;
    socket.to(room).emit(DOCUMENT_EVENTS.DOCUMENT_CURSOR_MOVED, {
      documentId,
      user: {
        id: user?.id || socket.id,
        name: user?.name || 'Anonymous User',
        avatar: user?.avatar
      },
      cursor
    });
  });

  socket.on(DOCUMENT_EVENTS.WHITEBOARD_EMBEDDED, (data: {
    documentId: string;
    whiteboardId: string;
    embedData?: any;
  }) => {
    const { documentId, whiteboardId, embedData } = data || {};
    if (!documentId || !whiteboardId) return;

    const room = `document:${documentId}`;
    socket.to(room).emit(DOCUMENT_EVENTS.WHITEBOARD_EMBEDDED, {
      documentId,
      whiteboardId,
      embedData,
      embeddedBy: {
        id: user?.id || socket.id,
        name: user?.name || 'Anonymous'
      }
    });
  });

  socket.on(DOCUMENT_EVENTS.MEETING_DOCUMENT_OPENED, (data: {
    meetingCodeOrId: string;
    documentId: string;
    documentTitle?: string;
  }) => {
    const { meetingCodeOrId, documentId, documentTitle } = data || {};
    if (!meetingCodeOrId || !documentId) return;

    io.to(`meeting:${meetingCodeOrId}`).emit(DOCUMENT_EVENTS.MEETING_DOCUMENT_OPENED, {
      meetingCodeOrId,
      documentId,
      documentTitle,
      openedBy: {
        id: user?.id || socket.id,
        name: user?.name || 'Anonymous'
      }
    });
  });

  socket.on(DOCUMENT_EVENTS.MEETING_DOCUMENT_CLOSED, (data: {
    meetingCodeOrId: string;
    documentId: string;
  }) => {
    const { meetingCodeOrId, documentId } = data || {};
    if (!meetingCodeOrId || !documentId) return;

    io.to(`meeting:${meetingCodeOrId}`).emit(DOCUMENT_EVENTS.MEETING_DOCUMENT_CLOSED, {
      meetingCodeOrId,
      documentId,
      closedBy: {
        id: user?.id || socket.id,
        name: user?.name || 'Anonymous'
      }
    });
  });

  socket.on('disconnect', () => {
    const userDocs = socketDocMap.get(socket.id);
    if (!userDocs) return;

    for (const docId of userDocs) {
      if (docUsersMap.has(docId)) {
        docUsersMap.get(docId)!.delete(socket.id);
        if (docUsersMap.get(docId)!.size === 0) {
          docUsersMap.delete(docId);
        }
      }

      socket.to(`document:${docId}`).emit(DOCUMENT_EVENTS.DOCUMENT_USER_LEFT, {
        documentId: docId,
        userId: user?.id || socket.id,
        socketId: socket.id
      });
    }

    socketDocMap.delete(socket.id);
  });
};
