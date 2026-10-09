import { Server as SocketIOServer, Socket } from 'socket.io';
import { roomBroker } from '../sfu/roomBroker.js';

export const registerSfuSignalingHandler = (io: SocketIOServer, socket: Socket) => {
  socket.on('sfu:join-media', (payload: { meetingCode: string }, ack?: (res: any) => void) => {
    const user = socket.data.user;
    if (!user || !user.id || !payload?.meetingCode) {
      ack?.({ success: false, code: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }

    const normalizedCode = payload.meetingCode.trim();
    roomBroker.addPeer(normalizedCode, {
      userId: user.id,
      socketId: socket.id,
      joinedAt: new Date(),
    });

    ack?.({ success: true });
  });
};
