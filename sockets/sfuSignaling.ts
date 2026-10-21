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
    const targetRoom = rCode || currentRoom;
    const targetPeer = pId || currentPeerId;
    if (targetRoom && targetPeer) {
      const pc = subscriberPeerConnections.get(`${targetRoom}:${targetPeer}:${tId}`);
      if (pc) return pc;
    }
    if (targetRoom) {
      for (const [key, pc] of subscriberPeerConnections.entries()) {
        if (key.startsWith(`${targetRoom}:`) && key.endsWith(`:${tId}`)) {
          return pc;
        }
      }
    }
    return undefined;
  };

  const handleLeave = () => {
    const activeRoom = currentRoom;
    const activePeerId = currentPeerId;
    if (activeRoom && activePeerId) {
      const room = roomBroker.getOrCreateRoom(activeRoom);
      const peer = room.peers.get(activePeerId);
      const publishedTrackIds = peer ? Array.from(peer.publishedTracks.keys()) : [];

      if (peer?.peerConnection) {
        try {
          (peer.peerConnection as any).close();
        } catch {}
        peer.peerConnection = undefined;
      }

      for (const [key, pc] of subscriberPeerConnections.entries()) {
        const isSubscriberForPeer = key.startsWith(`${activeRoom}:${activePeerId}:`);
        const isTrackPublishedByPeer = publishedTrackIds.some((tId) => key.startsWith(`${activeRoom}:`) && key.endsWith(`:${tId}`));
        if (isSubscriberForPeer || isTrackPublishedByPeer) {
          try {
            pc.close();
          } catch {}
          subscriberPeerConnections.delete(key);
        }
      }

      for (const tId of publishedTrackIds) {
        socket.to(activeRoom).emit('sfu:track-unpublished', {
          peerId: activePeerId,
          trackId: tId,
        });
      }

      roomBroker.removePeer(activeRoom, activePeerId);
      socket.to(activeRoom).emit('sfu:peer-left', { peerId: activePeerId });
      socket.leave(activeRoom);
      logger.info(`[Signaling] Peer ${activePeerId} left room ${activeRoom}`);
      currentRoom = null;
      currentPeerId = null;
    }
  };

  socket.on('sfu:join', ({ roomCode, peerId, name }: JoinPayload) => {
    if (!roomCode) {
      socket.emit('sfu:error', { message: 'roomCode is required' });
      return;
    }

    const effectivePeerId = socket.data.user?.isAuthenticated
      ? socket.data.user.id
      : (peerId || socket.id);
    const effectiveName = name || socket.data.user?.name || 'Participant';

    if (currentRoom && (currentRoom !== roomCode || currentPeerId !== effectivePeerId)) {
      handleLeave();
    }

    currentRoom = roomCode;
    currentPeerId = effectivePeerId;

    socket.join(roomCode);
    roomBroker.addPeer(roomCode, effectivePeerId, socket.id, effectiveName);

    const existingTracks = roomBroker.getRoomTracks(roomCode).map((t) => ({
      trackId: t.trackId,
      kind: t.kind,
      peerId: t.peerId,
    }));

    socket.emit('sfu:joined', { existingTracks, peerId: effectivePeerId });
    socket.to(roomCode).emit('sfu:peer-joined', { peerId: effectivePeerId, name: effectiveName });

    for (const t of existingTracks) {
      if (t.peerId !== effectivePeerId) {
        socket.emit('sfu:new-producer', {
          peerId: t.peerId,
          trackId: t.trackId,
          kind: t.kind,
        });
      }
    }

    logger.info(`[Signaling] Peer ${effectivePeerId} joined SFU room ${roomCode}`);
  });

  socket.on('sfu:offer', async ({ roomCode, peerId, sdp }: OfferPayload) => {
    try {
      const activeRoom = currentRoom;
      const activePeerId = currentPeerId;
      const rCode = roomCode || activeRoom;
      const pId = peerId || activePeerId;
      if (!activeRoom || rCode !== activeRoom || !activePeerId || pId !== activePeerId) {
        logger.warn(`[Signaling] Unauthorized sfu:offer from socket ${socket.id} for room ${rCode} peer ${pId}`);
        socket.emit('sfu:error', { message: 'Unauthorized room or peer for offer' });
        return;
      }

      const room = roomBroker.getOrCreateRoom(activeRoom);
      const peer = room.peers.get(activePeerId);

      if (!peer) {
        logger.error(`[Signaling] Peer ${activePeerId} not found in room ${activeRoom}`);
        return;
      }

      if (peer.peerConnection) {
        try {
          const oldTrackIds = Array.from(peer.publishedTracks.keys());
          for (const oldTrackId of oldTrackIds) {
            for (const [key, subPc] of subscriberPeerConnections.entries()) {
              if (key.startsWith(`${activeRoom}:`) && key.endsWith(`:${oldTrackId}`)) {
                try {
                  subPc.close();
                } catch {}
                subscriberPeerConnections.delete(key);
              }
            }
            roomBroker.unpublishTrack(activeRoom, activePeerId, oldTrackId);
            socket.to(activeRoom).emit('sfu:track-unpublished', { peerId: activePeerId, trackId: oldTrackId });
          }
          (peer.peerConnection as any).close();
        } catch (err) {
          logger.warn(`[Signaling] Error cleaning up previous publisher peerConnection for ${activePeerId}:`, err);
        }
        peer.peerConnection = undefined;
        peer.inboundSrtpSession = undefined;
        peer.outboundSrtpSession = undefined;
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
              roomBroker.attachPublisherSrtpSessions(activeRoom, activePeerId, inboundSession, outboundSession);
              logger.info(`[Signaling] Publisher DTLS connected and SRTP sessions attached for peer ${activePeerId}`);
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
        const publishedTrack = roomBroker.publishTrack(activeRoom, activePeerId, track);

        socket.to(activeRoom).emit('sfu:new-producer', {
          peerId: activePeerId,
          trackId: publishedTrack.trackId,
          kind: publishedTrack.kind,
        });
      });

      pc.onIceCandidate.subscribe((candidate) => {
        if (candidate) {
          socket.emit('sfu:ice-candidate', {
            roomCode: activeRoom,
            peerId: activePeerId,
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

      logger.info(`[Signaling] Negotiated publishing offer/answer for peer ${activePeerId}`);
    } catch (err) {
      logger.error(`[Signaling] Error handling offer from peer ${currentPeerId}:`, err);
      socket.emit('sfu:error', { message: 'Failed to process SDP offer' });
    }
  });

  socket.on('sfu:ice-candidate', async ({ roomCode, peerId, candidate, target, trackId }: CandidatePayload) => {
    try {
      if (!candidate) return;
      const activeRoom = currentRoom;
      const activePeerId = currentPeerId;
      const rCode = roomCode || activeRoom;
      const pId = peerId || activePeerId;
      if (!activeRoom || rCode !== activeRoom || !activePeerId || pId !== activePeerId) {
        return;
      }

      if (target === 'subscriber' || trackId) {
        const consumerPc = findSubscriberPc(activeRoom, activePeerId, trackId);
        if (consumerPc) {
          await consumerPc.addIceCandidate(candidate);
          logger.debug(`[Signaling] Added subscriber ICE candidate for track ${trackId}`);
          return;
        }
      }

      if (target === 'publisher' || !target) {
        const room = roomBroker.getOrCreateRoom(activeRoom);
        const peer = room.peers.get(activePeerId);
        if (peer?.peerConnection) {
          await peer.peerConnection.addIceCandidate(candidate);
          logger.debug(`[Signaling] Added publisher ICE candidate for peer ${activePeerId}`);
          return;
        }
      }

      for (const [key, pc] of subscriberPeerConnections.entries()) {
        if (key.startsWith(`${activeRoom}:${activePeerId}:`)) {
          pc.addIceCandidate(candidate).catch(() => {});
        }
      }
    } catch (err) {
      logger.error(`[Signaling] Error adding ICE candidate:`, err);
    }
  });

  socket.on('sfu:subscribe-ice-candidate', async ({ roomCode, peerId, trackId, candidate }: any) => {
    try {
      if (!candidate || !trackId) return;
      const activeRoom = currentRoom;
      const activePeerId = currentPeerId;
      const rCode = roomCode || activeRoom;
      const pId = peerId || activePeerId;
      if (!activeRoom || rCode !== activeRoom || !activePeerId || pId !== activePeerId) {
        return;
      }
      const consumerPc = findSubscriberPc(activeRoom, activePeerId, trackId);
      if (consumerPc) {
        await consumerPc.addIceCandidate(candidate);
        logger.debug(`[Signaling] Added subscriber ICE candidate via sfu:subscribe-ice-candidate for track ${trackId}`);
      }
    } catch (err) {
      logger.error(`[Signaling] Error adding subscribe ICE candidate for track ${trackId}:`, err);
    }
  });

  socket.on('sfu:request-keyframe', ({ roomCode, publisherPeerId, trackId }: { roomCode: string; publisherPeerId: string; trackId?: string }) => {
    const activeRoom = currentRoom;
    const activePeerId = currentPeerId;
    const rCode = roomCode || activeRoom;
    if (!activeRoom || rCode !== activeRoom || !activePeerId || !publisherPeerId) {
      return;
    }
    logger.info(`[Signaling] Manual keyframe requested by ${activePeerId} for publisher ${publisherPeerId} in room ${activeRoom}`);
    roomBroker.requestKeyframe(activeRoom, publisherPeerId, trackId);
  });

  socket.on(
    'sfu:subscribe',
    async ({ roomCode, subscriberPeerId, trackId, sdp }: SubscribePayload) => {
      const activeRoom = currentRoom;
      const activePeerId = currentPeerId;
      const rCode = roomCode || activeRoom;
      const subPeerId = subscriberPeerId || activePeerId;
      if (!activeRoom || rCode !== activeRoom || !activePeerId || subPeerId !== activePeerId) {
        logger.warn(`[Signaling] Unauthorized sfu:subscribe from socket ${socket.id} for room ${rCode} peer ${subPeerId}`);
        socket.emit('sfu:error', { message: 'Unauthorized room or peer for subscription' });
        return;
      }

      const subKey = `${activeRoom}:${activePeerId}:${trackId}`;
      let consumerPc: RTCPeerConnection | null = null;
      try {
        const room = roomBroker.getOrCreateRoom(activeRoom);
        const peer = room.peers.get(activePeerId);

        if (!peer) {
          logger.error(`[Signaling] Subscriber peer ${activePeerId} not found`);
          return;
        }

        const publishedTrack = roomBroker
          .getRoomTracks(activeRoom)
          .find((t) => t.trackId === trackId);

        if (!publishedTrack) {
          logger.error(`[Signaling] Track ${trackId} not found in room ${activeRoom}`);
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
              roomCode: activeRoom,
              peerId: activePeerId,
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
            roomBroker.requestKeyframe(activeRoom, publishedTrack.peerId, trackId);
          });
        }

        const subscribed = roomBroker.subscribeToTrack(
          activeRoom,
          activePeerId,
          trackId,
          transceiver.sender,
          consumerPc
        );

        if (!subscribed) {
          logger.error(`[Signaling] Failed to subscribe peer ${activePeerId} to track ${trackId}`);
          try {
            consumerPc.close();
          } catch {}
          subscriberPeerConnections.delete(subKey);
          roomBroker.unsubscribeFromTrack(activeRoom, activePeerId, trackId);
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
                roomBroker.attachSubscriberSrtpSession(activeRoom, activePeerId, trackId, outboundSession);
                roomBroker.markSubscriberReady(activeRoom, activePeerId, trackId);
                if (publishedTrack.kind === 'video') {
                  roomBroker.requestKeyframe(activeRoom, publishedTrack.peerId, trackId);
                }
                logger.info(`[Signaling] Subscriber DTLS connected and track-specific SRTP session attached for peer ${activePeerId} on track ${trackId}`);
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
          `[Signaling] Peer ${activePeerId} subscribed to track ${trackId}`
        );

      } catch (err) {
        logger.error(`[Signaling] Error subscribing to track:`, err);
        if (consumerPc) {
          try {
            consumerPc.close();
          } catch {}
        }
        subscriberPeerConnections.delete(subKey);
        roomBroker.unsubscribeFromTrack(activeRoom, activePeerId, trackId);
        socket.emit('sfu:error', { message: 'Failed to subscribe to track' });
      }
    }
  );

  socket.on('sfu:unsubscribe', ({ roomCode, subscriberPeerId, trackId }: { roomCode: string; subscriberPeerId: string; trackId: string }) => {
    const activeRoom = currentRoom;
    const activePeerId = currentPeerId;
    const rCode = roomCode || activeRoom;
    const subPeerId = subscriberPeerId || activePeerId;
    if (!activeRoom || rCode !== activeRoom || !activePeerId || subPeerId !== activePeerId || !trackId) {
      return;
    }
    const subKey = `${activeRoom}:${activePeerId}:${trackId}`;
    const pc = subscriberPeerConnections.get(subKey);
    if (pc) {
      try {
        pc.close();
      } catch {}
      subscriberPeerConnections.delete(subKey);
    }
    roomBroker.unsubscribeFromTrack(activeRoom, activePeerId, trackId);
    logger.info(`[Signaling] Peer ${activePeerId} unsubscribed from track ${trackId}`);
  });

  socket.on('sfu:unpublish', ({ roomCode, peerId, trackId }: { roomCode: string; peerId: string; trackId: string }) => {
    const activeRoom = currentRoom;
    const activePeerId = currentPeerId;
    const rCode = roomCode || activeRoom;
    const pId = peerId || activePeerId;
    if (!activeRoom || rCode !== activeRoom || !activePeerId || pId !== activePeerId || !trackId) {
      return;
    }

    for (const [key, pc] of subscriberPeerConnections.entries()) {
      if (key.startsWith(`${activeRoom}:`) && key.endsWith(`:${trackId}`)) {
        try {
          pc.close();
        } catch {}
        subscriberPeerConnections.delete(key);
      }
    }

    const unpublished = roomBroker.unpublishTrack(activeRoom, activePeerId, trackId);
    if (unpublished) {
      socket.to(activeRoom).emit('sfu:track-unpublished', { peerId: activePeerId, trackId });
      logger.info(`[Signaling] Peer ${activePeerId} unpublished track ${trackId}`);
    }
  });

  socket.on('sfu:leave', handleLeave);
  socket.on('disconnect', handleLeave);
};
