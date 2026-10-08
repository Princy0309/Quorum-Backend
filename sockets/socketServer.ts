import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: any;
  };
}

let ioServer: SocketIOServer | null = null;

export const getIO = (): SocketIOServer => {
  if (!ioServer) {
    throw new Error('Socket.io server has not been initialized');
  }
  return ioServer;
};

export const initSocketServer = (httpServer: HTTPServer): SocketIOServer => {
  ioServer = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      credentials: true,
    },
  });

  ioServer.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return ioServer;
};
