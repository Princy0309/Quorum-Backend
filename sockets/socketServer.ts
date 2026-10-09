import { Server } from 'socket.io';
import { registerSfuSignaling } from './sfuSignaling.js';
import logger from '../utils/logger.js';

export const initSocketServer = (httpServer: any) => {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    logger.info(`[Socket] Client connected: ${socket.id}`);
    registerSfuSignaling(io, socket);

    socket.on('disconnect', () => {
      logger.info(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};
