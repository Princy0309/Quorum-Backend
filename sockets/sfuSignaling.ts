import { Server, Socket } from 'socket.io';
import { RTCSessionDescription, RTCPeerConnection } from 'werift';
import { roomBroker } from '../sfu/roomBroker.js';
import { createPeerConnection } from '../sfu/peerConnection.js';
import { SrtpContext } from '../sfu/protocols/srtp/srtpContext.js';
import { SrtpSession } from '../sfu/protocols/srtp/srtpPacket.js';
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
  target?: 'publisher' | 'subscriber';
  trackId?: string;
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

const subscriberPeerConnections = new Map<string, RTCPeerConnection>();

export const registerSfuSignaling = (io: Server, socket: Socket) => {
  let currentRoom: string | null = null;
  let currentPeerId: string | null = null;

  const findSubscriberPc = (rCode?: string, pId?: string, tId?: string): RTCPeerConnection | undefined => {
    if (!tId) return undefined;
    if (rCode && pId) {
      const pc = subscriberPeerConnections.get(`${rCode}:${pId}:${tId}`);
      if (pc) return pc;
    }
    if (rCode && currentPeerId) {
      const pc = subscriberPeerConnections.get(`${rCode}:${currentPeerId}:${tId}`);
      if (pc) return pc;
    }
    for (const [key, pc] of subscriberPeerConnections.entries()) {
      if (key.endsWith(`:${tId}`)) {
        if (!rCode || key.startsWith(`${rCode}:`)) {
          return pc;
        }
      }
    }
    return undefined;
  };

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

    for (const t of existingTracks) {
      if (t.peerId !== peerId) {
        socket.emit('sfu:new-producer', {
          peerId: t.peerId,
          trackId: t.trackId,
          kind: t.kind,
        });
      }
    }

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

      for (const dtlsTransport of (pc as any).dtlsTransports || []) {
        const onPublisherDtlsConnected = () => {
          try {
            const dtls = (dtlsTransport as any).dtls;
            if (dtls && typeof dtls.extractSessionKeys === 'function') {
              const { localKey, localSalt, remoteKey, remoteSalt } = dtls.extractSessionKeys(16, 14);
              const inboundContext = new SrtpContext(remoteKey, remoteSalt);
              const outboundContext = new SrtpContext(localKey, localSalt);
              const inboundSession = new SrtpSession(inboundContext, false);
              const outboundSession = new SrtpSession(outboundContext, true);
              roomBroker.attachPublisherSrtpSessions(roomCode, peerId, inboundSession, outboundSession);
              logger.info(`[Signaling] Publisher DTLS connected and SRTP sessions attached for peer ${peerId}`);
            }
          } catch (err) {
            logger.error(`[Signaling] Failed to extract publisher SRTP session keys:`, err);
          }
        };

        if (dtlsTransport.state === 'connected') {
          onPublisherDtlsConnected();
        } else {
          dtlsTransport.onStateChange.subscribe((state: string) => {
            if (state === 'connected') {
              onPublisherDtlsConnected();
            }
          });
        }
      }

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
          socket.emit('sfu:ice-candidate', {
            roomCode,
            peerId,
            target: 'publisher',
            candidate: candidate.toJSON ? candidate.toJSON() : candidate,
          });
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

  socket.on('sfu:ice-candidate', async ({ roomCode, peerId, candidate, target, trackId }: CandidatePayload) => {
    try {
      if (!candidate) return;
      const rCode = roomCode || currentRoom;
      const pId = peerId || currentPeerId;

      if (target === 'subscriber' || trackId) {
        const consumerPc = findSubscriberPc(rCode || undefined, pId || undefined, trackId);
        if (consumerPc) {
          await consumerPc.addIceCandidate(candidate);
          logger.debug(`[Signaling] Added subscriber ICE candidate for track ${trackId}`);
          return;
        }
      }

      if (target === 'publisher' || !target) {
        if (rCode && pId) {
          const room = roomBroker.getOrCreateRoom(rCode);
          const peer = room.peers.get(pId);
          if (peer?.peerConnection) {
            await peer.peerConnection.addIceCandidate(candidate);
            logger.debug(`[Signaling] Added publisher ICE candidate for peer ${pId}`);
            return;
          }
        }
      }

      if (rCode && pId) {
        for (const [key, pc] of subscriberPeerConnections.entries()) {
          if (key.startsWith(`${rCode}:${pId}:`)) {
            pc.addIceCandidate(candidate).catch(() => {});
          }
        }
      }
    } catch (err) {
      logger.error(`[Signaling] Error adding ICE candidate:`, err);
    }
  });

  socket.on('sfu:subscribe-ice-candidate', async ({ roomCode, peerId, trackId, candidate }: any) => {
    try {
      if (!candidate || !trackId) return;
      const rCode = roomCode || currentRoom;
      const pId = peerId || currentPeerId;
      const consumerPc = findSubscriberPc(rCode || undefined, pId || undefined, trackId);
      if (consumerPc) {
        await consumerPc.addIceCandidate(candidate);
        logger.debug(`[Signaling] Added subscriber ICE candidate via sfu:subscribe-ice-candidate for track ${trackId}`);
      }
    } catch (err) {
      logger.error(`[Signaling] Error adding subscribe ICE candidate for track ${trackId}:`, err);
    }
  });

  socket.on('sfu:request-keyframe', ({ roomCode, publisherPeerId, trackId }: { roomCode: string; publisherPeerId: string; trackId?: string }) => {
    const rCode = roomCode || currentRoom;
    if (rCode && publisherPeerId) {
      logger.info(`[Signaling] Manual keyframe requested for publisher ${publisherPeerId} in room ${rCode}`);
      roomBroker.requestKeyframe(rCode, publisherPeerId, trackId);
    }
  });

  socket.on(
    'sfu:subscribe',
    async ({ roomCode, subscriberPeerId, trackId, sdp }: SubscribePayload) => {
      const subKey = `${roomCode}:${subscriberPeerId}:${trackId}`;
      let consumerPc: RTCPeerConnection | null = null;
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

        const existingPc = subscriberPeerConnections.get(subKey);
        if (existingPc) {
          try {
            existingPc.close();
          } catch {}
          subscriberPeerConnections.delete(subKey);
        }

        consumerPc = createPeerConnection();
        subscriberPeerConnections.set(subKey, consumerPc);

        consumerPc.onIceCandidate.subscribe((candidate) => {
          if (candidate) {
            socket.emit('sfu:ice-candidate', {
              roomCode,
              peerId: subscriberPeerId,
              target: 'subscriber',
              trackId,
              candidate: candidate.toJSON ? candidate.toJSON() : candidate,
            });
            socket.emit('sfu:subscribe-ice-candidate', {
              trackId,
              candidate: candidate.toJSON ? candidate.toJSON() : candidate,
            });
          }
        });

        const transceiver = consumerPc.addTransceiver(publishedTrack.kind, {
          direction: 'sendonly',
        });

        if (publishedTrack.kind === 'video') {
          transceiver.sender.onPictureLossIndication.subscribe(() => {
            logger.info(`[Signaling] PLI received: requesting keyframe from publisher ${publishedTrack.peerId}`);
            roomBroker.requestKeyframe(roomCode, publishedTrack.peerId, trackId);
          });
        }

        const subscribed = roomBroker.subscribeToTrack(
          roomCode,
          subscriberPeerId,
          trackId,
          transceiver.sender,
          consumerPc
        );

        if (!subscribed) {
          logger.error(`[Signaling] Failed to subscribe peer ${subscriberPeerId} to track ${trackId}`);
          try {
            consumerPc.close();
          } catch {}
          subscriberPeerConnections.delete(subKey);
          roomBroker.unsubscribeFromTrack(roomCode, subscriberPeerId, trackId);
          socket.emit('sfu:error', { message: 'Failed to subscribe to track' });
          return;
        }

        await consumerPc.setRemoteDescription(
          new RTCSessionDescription(sdp.sdp, sdp.type)
        );
        const answer = await consumerPc.createAnswer();
        await consumerPc.setLocalDescription(answer);

        for (const dtlsTransport of (consumerPc as any).dtlsTransports || []) {
          const onSubscriberDtlsConnected = () => {
            try {
              const dtls = (dtlsTransport as any).dtls;
              if (dtls && typeof dtls.extractSessionKeys === 'function') {
                const { localKey, localSalt } = dtls.extractSessionKeys(16, 14);
                const outboundContext = new SrtpContext(localKey, localSalt);
                const outboundSession = new SrtpSession(outboundContext, true);
                roomBroker.attachSubscriberSrtpSession(roomCode, subscriberPeerId, trackId, outboundSession);
                roomBroker.markSubscriberReady(roomCode, subscriberPeerId, trackId);
                if (publishedTrack.kind === 'video') {
                  roomBroker.requestKeyframe(roomCode, publishedTrack.peerId, trackId);
                }
                logger.info(`[Signaling] Subscriber DTLS connected and track-specific SRTP session attached for peer ${subscriberPeerId} on track ${trackId}`);
              }
            } catch (err) {
              logger.error(`[Signaling] Failed to extract subscriber SRTP session keys:`, err);
            }
          };

          if (dtlsTransport.state === 'connected') {
            onSubscriberDtlsConnected();
          } else {
            dtlsTransport.onStateChange.subscribe((state: string) => {
              if (state === 'connected') {
                onSubscriberDtlsConnected();
              }
            });
          }
        }

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
        if (consumerPc) {
          try {
            consumerPc.close();
          } catch {}
        }
        subscriberPeerConnections.delete(subKey);
        roomBroker.unsubscribeFromTrack(roomCode, subscriberPeerId, trackId);
        socket.emit('sfu:error', { message: 'Failed to subscribe to track' });
      }
    }
  );

  socket.on('sfu:unsubscribe', ({ roomCode, subscriberPeerId, trackId }: { roomCode: string; subscriberPeerId: string; trackId: string }) => {
    const rCode = roomCode || currentRoom;
    const pId = subscriberPeerId || currentPeerId;
    if (!rCode || !pId || !trackId) return;
    const subKey = `${rCode}:${pId}:${trackId}`;
    const pc = subscriberPeerConnections.get(subKey);
    if (pc) {
      try {
        pc.close();
      } catch {}
      subscriberPeerConnections.delete(subKey);
    }
    roomBroker.unsubscribeFromTrack(rCode, pId, trackId);
    logger.info(`[Signaling] Peer ${pId} unsubscribed from track ${trackId}`);
  });

  socket.on('sfu:unpublish', ({ roomCode, peerId, trackId }: { roomCode: string; peerId: string; trackId: string }) => {
    const rCode = roomCode || currentRoom;
    const pId = peerId || currentPeerId;
    if (!rCode || !pId || !trackId) return;

    for (const [key, pc] of subscriberPeerConnections.entries()) {
      if (key.endsWith(`:${trackId}`)) {
        try {
          pc.close();
        } catch {}
        subscriberPeerConnections.delete(key);
      }
    }

    const unpublished = roomBroker.unpublishTrack(rCode, pId, trackId);
    if (unpublished) {
      socket.to(rCode).emit('sfu:track-unpublished', { peerId: pId, trackId });
      logger.info(`[Signaling] Peer ${pId} unpublished track ${trackId}`);
    }
  });

  const handleLeave = () => {
    if (currentRoom && currentPeerId) {
      const room = roomBroker.getOrCreateRoom(currentRoom);
      const peer = room.peers.get(currentPeerId);
      const publishedTrackIds = peer ? Array.from(peer.publishedTracks.keys()) : [];

      for (const [key, pc] of subscriberPeerConnections.entries()) {
        const isSubscriberForPeer = key.includes(`:${currentPeerId}:`);
        const isTrackPublishedByPeer = publishedTrackIds.some((tId) => key.endsWith(`:${tId}`));
        if (isSubscriberForPeer || isTrackPublishedByPeer) {
          try {
            pc.close();
          } catch {}
          subscriberPeerConnections.delete(key);
        }
      }

      for (const tId of publishedTrackIds) {
        socket.to(currentRoom).emit('sfu:track-unpublished', {
          peerId: currentPeerId,
          trackId: tId,
        });
      }

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
