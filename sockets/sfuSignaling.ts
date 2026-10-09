import { Server as SocketIOServer, Socket } from 'socket.io';
import { roomBroker } from '../sfu/roomBroker.js';
import { peerConnectionManager } from '../sfu/peerConnection.js';
import { meetingRooms } from './meetingPresence.js';

export const registerSfuSignalingHandler = (io: SocketIOServer, socket: Socket) => {
  const validateParticipant = (meetingCode: string): boolean => {
    const user = socket.data.user;
    if (!user || !user.id || !meetingCode) return false;

    const normalizedCode = meetingCode.trim();
    const roomState = meetingRooms.get(normalizedCode);
    if (!roomState) return false;

    const participant = roomState.participants.get(user.id);
    if (!participant || !participant.socketIds.has(socket.id)) {
      return false;
    }

    return true;
  };

  socket.on('sfu:join-media', (payload: { meetingCode: string }, ack?: (res: any) => void) => {
    const user = socket.data.user;
    if (!user || !user.id || !payload?.meetingCode) {
      ack?.({ success: false, code: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }

    const normalizedCode = payload.meetingCode.trim();
    if (!validateParticipant(normalizedCode)) {
      ack?.({
        success: false,
        code: 'NOT_ACTIVE_PARTICIPANT',
        message: 'You must be an active admitted participant to join media',
      });
      return;
    }

    roomBroker.addPeer(normalizedCode, {
      userId: user.id,
      socketId: socket.id,
      joinedAt: new Date(),
      tracks: new Map(),
    });

    ack?.({ success: true });
  });

  socket.on(
    'sfu:send-offer',
    async (
      payload: { meetingCode: string; offer: any },
      ack?: (res: any) => void
    ) => {
      const user = socket.data.user;
      if (!user || !user.id || !payload?.meetingCode || !payload?.offer) {
        ack?.({ success: false, code: 'INVALID_PAYLOAD', message: 'Meeting code and offer required' });
        return;
      }

      const normalizedCode = payload.meetingCode.trim();
      if (!validateParticipant(normalizedCode)) {
        ack?.({
          success: false,
          code: 'NOT_ACTIVE_PARTICIPANT',
          message: 'You must be an active admitted participant to negotiate media',
        });
        return;
      }

      try {
        const answer = await peerConnectionManager.handleOffer(
          normalizedCode,
          socket.id,
          user.id,
          payload.offer,
          (candidate) => {
            socket.emit('sfu:ice-candidate', { meetingCode: normalizedCode, candidate });
          },
          (targetSocketId, offer) => {
            io.to(targetSocketId).emit('sfu:renegotiate-offer', {
              meetingCode: normalizedCode,
              offer,
            });
          }
        );

        ack?.({ success: true, data: { answer } });
      } catch (err: any) {
        console.error('Failed to handle SFU offer:', err);
        ack?.({ success: false, code: 'SFU_OFFER_FAILED', message: err.message || 'Failed to process offer' });
      }
    }
  );

  socket.on(
    'sfu:send-answer',
    async (
      payload: { meetingCode: string; answer: any },
      ack?: (res: any) => void
    ) => {
      const user = socket.data.user;
      if (!user || !user.id || !payload?.meetingCode || !payload?.answer) {
        ack?.({ success: false, code: 'INVALID_PAYLOAD', message: 'Meeting code and answer required' });
        return;
      }

      const normalizedCode = payload.meetingCode.trim();
      if (!validateParticipant(normalizedCode)) {
        ack?.({
          success: false,
          code: 'NOT_ACTIVE_PARTICIPANT',
          message: 'You must be an active admitted participant to negotiate media',
        });
        return;
      }

      try {
        await peerConnectionManager.handleAnswer(normalizedCode, socket.id, payload.answer);
        ack?.({ success: true });
      } catch (err: any) {
        console.error('Failed to handle SFU answer:', err);
        ack?.({ success: false, code: 'SFU_ANSWER_FAILED', message: err.message || 'Failed to process answer' });
      }
    }
  );

  socket.on(
    'sfu:send-ice-candidate',
    async (
      payload: { meetingCode: string; candidate: any },
      ack?: (res: any) => void
    ) => {
      const user = socket.data.user;
      if (!user || !user.id || !payload?.meetingCode || !payload?.candidate) {
        ack?.({ success: false, code: 'INVALID_PAYLOAD', message: 'Meeting code and candidate required' });
        return;
      }

      const normalizedCode = payload.meetingCode.trim();
      if (!validateParticipant(normalizedCode)) {
        ack?.({
          success: false,
          code: 'NOT_ACTIVE_PARTICIPANT',
          message: 'You must be an active admitted participant to exchange ICE candidates',
        });
        return;
      }

      try {
        await peerConnectionManager.handleIceCandidate(normalizedCode, socket.id, payload.candidate);
        ack?.({ success: true });
      } catch (err: any) {
        console.error('Failed to handle SFU ICE candidate:', err);
        ack?.({ success: false, code: 'SFU_ICE_FAILED', message: err.message || 'Failed to process ICE candidate' });
      }
    }
  );

  socket.on('disconnect', () => {
    peerConnectionManager.closeAllSocketConnections(socket.id);
  });
};
