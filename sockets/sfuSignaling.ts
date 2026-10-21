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

interface SubscriberConnectionKey {
  roomCode: string;
  peerId: string;
  trackId: string;
}

class SubscriberConnectionRegistry {
  private connections = new Map<string, { key: SubscriberConnectionKey; pc: RTCPeerConnection }>();

  private buildKey(roomCode: string, peerId: string, trackId: string): string {
    return `${encodeURIComponent(roomCode)}#${encodeURIComponent(peerId)}#${encodeURIComponent(trackId)}`;
  }

  public set(roomCode: string, peerId: string, trackId: string, pc: RTCPeerConnection): void {
    const id = this.buildKey(roomCode, peerId, trackId);
    this.connections.set(id, { key: { roomCode, peerId, trackId }, pc });
  }

  public get(roomCode: string, peerId: string, trackId: string): RTCPeerConnection | undefined {
    return this.connections.get(this.buildKey(roomCode, peerId, trackId))?.pc;
  }

  public delete(roomCode: string, peerId: string, trackId: string): boolean {
    return this.connections.delete(this.buildKey(roomCode, peerId, trackId));
  }

  public getByRoomAndPeer(roomCode: string, peerId: string): RTCPeerConnection[] {
    const list: RTCPeerConnection[] = [];
    for (const entry of this.connections.values()) {
      if (entry.key.roomCode === roomCode && entry.key.peerId === peerId) {
        list.push(entry.pc);
      }
    }
    return list;
  }

  public removeByRoomAndTrack(roomCode: string, trackId: string): RTCPeerConnection[] {
    const removed: RTCPeerConnection[] = [];
    for (const [id, entry] of this.connections.entries()) {
      if (entry.key.roomCode === roomCode && entry.key.trackId === trackId) {
        removed.push(entry.pc);
        this.connections.delete(id);
      }
    }
    return removed;
  }

  public removeByRoomAndPeer(roomCode: string, peerId: string): RTCPeerConnection[] {
    const removed: RTCPeerConnection[] = [];
    for (const [id, entry] of this.connections.entries()) {
      if (entry.key.roomCode === roomCode && entry.key.peerId === peerId) {
        removed.push(entry.pc);
        this.connections.delete(id);
      }
    }
    return removed;
  }
}

const subscriberRegistry = new SubscriberConnectionRegistry();

export const registerSfuSignaling = (io: Server, socket: Socket) => {
  let currentRoom: string | null = null;
  let currentPeerId: string | null = null;

  const handleLeave = () => {
    const activeRoom = currentRoom;
    const activePeerId = currentPeerId;
    if (activeRoom && activePeerId) {
      const room = roomBroker.getRoom(activeRoom);
      const peer = room?.peers.get(activePeerId);

      if (peer && peer.socketId !== socket.id) {
        socket.leave(activeRoom);
        currentRoom = null;
        currentPeerId = null;
        return;
      }

      const publishedTrackIds = peer ? Array.from(peer.publishedTracks.keys()) : [];

      if (peer?.peerConnection) {
        try {
          (peer.peerConnection as any).close();
        } catch {}
        peer.peerConnection = undefined;
      }

      const closedSubs = subscriberRegistry.removeByRoomAndPeer(activeRoom, activePeerId);
      for (const pc of closedSubs) {
        try {
          pc.close();
        } catch {}
      }

      for (const tId of publishedTrackIds) {
        const closedTrackSubs = subscriberRegistry.removeByRoomAndTrack(activeRoom, tId);
        for (const pc of closedTrackSubs) {
          try {
            pc.close();
          } catch {}
        }
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

    if (!socket.data.user?.isAuthenticated) {
      logger.warn(`[Signaling] Rejecting unauthenticated SFU join from socket ${socket.id}`);
      socket.emit('sfu:error', { message: 'Authentication required to join SFU room' });
      return;
    }

    const effectivePeerId = socket.data.user.id;
    const effectiveName = socket.data.user.name || name || 'Participant';

    if (currentRoom) {
      handleLeave();
    }

    const existingRoom = roomBroker.getRoom(roomCode);
    const existingPeer = existingRoom?.peers.get(effectivePeerId);
    if (existingPeer && existingPeer.socketId && existingPeer.socketId !== socket.id) {
      io.to(existingPeer.socketId).emit('sfu:replaced', {
        roomCode,
        peerId: effectivePeerId,
        message: 'Session replaced by another connection'
      });
      existingPeer.socketId = socket.id;
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
            const closed = subscriberRegistry.removeByRoomAndTrack(activeRoom, oldTrackId);
            for (const subPc of closed) {
              try {
                subPc.close();
              } catch {}
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

      if (trackId) {
        const consumerPc = subscriberRegistry.get(activeRoom, activePeerId, trackId);
        if (consumerPc) {
          await consumerPc.addIceCandidate(candidate);
          logger.debug(`[Signaling] Added subscriber ICE candidate for track ${trackId}`);
          return;
        }
      } else if (target === 'subscriber') {
        const allSubs = subscriberRegistry.getByRoomAndPeer(activeRoom, activePeerId);
        for (const pc of allSubs) {
          pc.addIceCandidate(candidate).catch(() => {});
        }
        return;
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

      const allPeerSubs = subscriberRegistry.getByRoomAndPeer(activeRoom, activePeerId);
      for (const pc of allPeerSubs) {
        pc.addIceCandidate(candidate).catch(() => {});
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
      const consumerPc = subscriberRegistry.get(activeRoom, activePeerId, trackId);
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

        const existingPc = subscriberRegistry.get(activeRoom, activePeerId, trackId);
        if (existingPc) {
          try {
            existingPc.close();
          } catch {}
          subscriberRegistry.delete(activeRoom, activePeerId, trackId);
        }

        consumerPc = createPeerConnection();
        subscriberRegistry.set(activeRoom, activePeerId, trackId, consumerPc);

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
          subscriberRegistry.delete(activeRoom, activePeerId, trackId);
          roomBroker.unsubscribeFromTrack(activeRoom, activePeerId, trackId);
          socket.emit('sfu:error', { message: 'Failed to subscribe to track' });
          return;
        }

        await consumerPc.setRemoteDescription(
          new RTCSessionDescription(sdp.sdp, sdp.type)
        );

        if (subscriberRegistry.get(activeRoom, activePeerId, trackId) !== consumerPc) {
          logger.warn(`[Signaling] Subscription was cancelled or replaced after setRemoteDescription for track ${trackId}`);
          try {
            consumerPc.close();
          } catch {}
          return;
        }

        const answer = await consumerPc.createAnswer();

        if (subscriberRegistry.get(activeRoom, activePeerId, trackId) !== consumerPc) {
          logger.warn(`[Signaling] Subscription was cancelled or replaced after createAnswer for track ${trackId}`);
          try {
            consumerPc.close();
          } catch {}
          return;
        }

        await consumerPc.setLocalDescription(answer);

        if (subscriberRegistry.get(activeRoom, activePeerId, trackId) !== consumerPc) {
          logger.warn(`[Signaling] Subscription was cancelled or replaced after setLocalDescription for track ${trackId}`);
          try {
            consumerPc.close();
          } catch {}
          return;
        }

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

        if (subscriberRegistry.get(activeRoom, activePeerId, trackId) !== consumerPc) {
          logger.warn(`[Signaling] Subscription was cancelled prior to emitting response for track ${trackId}`);
          try {
            consumerPc.close();
          } catch {}
          return;
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
        subscriberRegistry.delete(activeRoom, activePeerId, trackId);
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
    const pc = subscriberRegistry.get(activeRoom, activePeerId, trackId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      subscriberRegistry.delete(activeRoom, activePeerId, trackId);
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

    const closed = subscriberRegistry.removeByRoomAndTrack(activeRoom, trackId);
    for (const pc of closed) {
      try {
        pc.close();
      } catch {}
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
