import { Server, Socket } from 'socket.io';
import { RTCSessionDescription } from 'werift';
import { roomBroker } from '../sfu/roomBroker.js';
import { createPeerConnection } from '../sfu/peerConnection.js';
import logger from '../utils/logger.js';

interface JoinPayload {
  roomCode: string;
  peerId: string;
  name?: string;
}

interface OfferPayload {
  roomCode: string;
  peerId: string;
  sdp: {
    type: 'offer';
    sdp: string;
  };
}

interface CandidatePayload {
  roomCode: string;
  peerId: string;
  candidate: any;
}

interface SubscribePayload {
  roomCode: string;
  subscriberPeerId: string;
  trackId: string;
  sdp: {
    type: 'offer';
    sdp: string;
  };
}

export const registerSfuSignaling = (io: Server, socket: Socket) => {
  let currentRoom: string | null = null;
  let currentPeerId: string | null = null;

  
  socket.on('sfu:join', ({ roomCode, peerId, name }: JoinPayload) => {
    currentRoom = roomCode;
    currentPeerId = peerId;

    socket.join(roomCode);
    roomBroker.addPeer(roomCode, peerId, socket.id, name);

    const existingTracks = roomBroker.getRoomTracks(roomCode).map((t) => ({
      trackId: t.trackId,
      kind: t.kind,
      peerId: t.peerId,
    }));

    socket.emit('sfu:joined', { existingTracks });
    socket.to(roomCode).emit('sfu:peer-joined', { peerId, name });

    logger.info(`[Signaling] Peer ${peerId} joined SFU room ${roomCode}`);
  });

  
  socket.on('sfu:offer', async ({ roomCode, peerId, sdp }: OfferPayload) => {
    try {
      const room = roomBroker.getOrCreateRoom(roomCode);
      const peer = room.peers.get(peerId);

      if (!peer) {
        logger.error(`[Signaling] Peer ${peerId} not found in room ${roomCode}`);
        return;
      }

      const pc = createPeerConnection();
      peer.peerConnection = pc;

      
      pc.onTrack.subscribe((track) => {
        const publishedTrack = roomBroker.publishTrack(roomCode, peerId, track);

        socket.to(roomCode).emit('sfu:new-producer', {
          peerId,
          trackId: publishedTrack.trackId,
          kind: publishedTrack.kind,
        });
      });

     
      pc.onIceCandidate.subscribe((candidate) => {
        if (candidate) {
          socket.emit('sfu:ice-candidate', { candidate });
        }
      });

      await pc.setRemoteDescription(new RTCSessionDescription(sdp.sdp, sdp.type));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('sfu:answer', {
        sdp: {
          type: answer.type,
          sdp: answer.sdp,
        },
      });

      logger.info(`[Signaling] Negotiated publishing offer/answer for peer ${peerId}`);
    } catch (err) {
      logger.error(`[Signaling] Error handling offer from peer ${peerId}:`, err);
      socket.emit('sfu:error', { message: 'Failed to process SDP offer' });
    }
  });

  
  socket.on('sfu:ice-candidate', async ({ roomCode, peerId, candidate }: CandidatePayload) => {
    try {
      const room = roomBroker.getOrCreateRoom(roomCode);
      const peer = room.peers.get(peerId);

      if (peer?.peerConnection && candidate) {
        await peer.peerConnection.addIceCandidate(candidate);
      }
    } catch (err) {
      logger.error(`[Signaling] Error adding ICE candidate for peer ${peerId}:`, err);
    }
  });

  
  socket.on(
    'sfu:subscribe',
    async ({ roomCode, subscriberPeerId, trackId, sdp }: SubscribePayload) => {
      try {
        const room = roomBroker.getOrCreateRoom(roomCode);
        const peer = room.peers.get(subscriberPeerId);

        if (!peer) {
          logger.error(`[Signaling] Subscriber peer ${subscriberPeerId} not found`);
          return;
        }

        const publishedTrack = roomBroker
          .getRoomTracks(roomCode)
          .find((t) => t.trackId === trackId);

        if (!publishedTrack) {
          logger.error(`[Signaling] Track ${trackId} not found in room ${roomCode}`);
          return;
        }

        const consumerPc = createPeerConnection();

        consumerPc.onIceCandidate.subscribe((candidate) => {
          if (candidate) {
            socket.emit('sfu:subscribe-ice-candidate', { trackId, candidate });
          }
        });

        
        const transceiver = consumerPc.addTransceiver(publishedTrack.kind, {
          direction: 'sendonly',
        });

        roomBroker.subscribeToTrack(
          roomCode,
          subscriberPeerId,
          trackId,
          transceiver.sender
        );

        await consumerPc.setRemoteDescription(
          new RTCSessionDescription(sdp.sdp, sdp.type)
        );
        const answer = await consumerPc.createAnswer();
        await consumerPc.setLocalDescription(answer);

        socket.emit('sfu:subscribed', {
          trackId,
          sdp: {
            type: answer.type,
            sdp: answer.sdp,
          },
        });

        logger.info(
          `[Signaling] Peer ${subscriberPeerId} subscribed to track ${trackId}`
        );
      } catch (err) {
        logger.error(`[Signaling] Error subscribing to track:`, err);
        socket.emit('sfu:error', { message: 'Failed to subscribe to track' });
      }
    }
  );

  
  const handleLeave = () => {
    if (currentRoom && currentPeerId) {
      roomBroker.removePeer(currentRoom, currentPeerId);
      socket.to(currentRoom).emit('sfu:peer-left', { peerId: currentPeerId });
      logger.info(`[Signaling] Peer ${currentPeerId} left room ${currentRoom}`);
      currentRoom = null;
      currentPeerId = null;
    }
  };

  socket.on('sfu:leave', handleLeave);
  socket.on('disconnect', handleLeave);
};
