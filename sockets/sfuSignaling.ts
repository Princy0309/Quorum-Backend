import { Server, Socket } from 'socket.io';
import { RTCSessionDescription, RTCPeerConnection } from 'werift';
import { roomBroker } from '../sfu/roomBroker.js';
import { createPeerConnection } from '../sfu/peerConnection.js';
import { SrtpContext } from '../sfu/protocols/srtp/srtpContext.js';
import { SrtpSession } from '../sfu/protocols/srtp/srtpPacket.js';
import logger from '../utils/logger.js';
import { RoomSharder } from '../sfu/roomSharder.js';
import { canUserJoinMeeting } from '../services/meetingPermissionService.js';



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

  public getEntriesByRoomAndPeer(roomCode: string, peerId: string): Array<{ trackId: string; pc: RTCPeerConnection }> {
    const list: Array<{ trackId: string; pc: RTCPeerConnection }> = [];
    for (const entry of this.connections.values()) {
      if (entry.key.roomCode === roomCode && entry.key.peerId === peerId) {
        list.push({ trackId: entry.key.trackId, pc: entry.pc });
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
const pendingPublisherCandidates = new Map<string, any[]>();
const pendingSubscriberCandidates = new Map<string, any[]>();

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

      pendingPublisherCandidates.delete(`${activeRoom}:${activePeerId}`);

      for (const tId of publishedTrackIds) {
        const closedTrackSubs = subscriberRegistry.removeByRoomAndTrack(activeRoom, tId);
        for (const pc of closedTrackSubs) {
          try {
            pc.close();
          } catch {}
        }
        for (const key of pendingSubscriberCandidates.keys()) {
          if (key.startsWith(`${activeRoom}:`) && key.endsWith(`:${tId}`)) {
            pendingSubscriberCandidates.delete(key);
          }
        }
        socket.to(activeRoom).emit('sfu:track-unpublished', {
          peerId: activePeerId,
          trackId: tId,
        });
      }

      for (const key of pendingSubscriberCandidates.keys()) {
        if (key.startsWith(`${activeRoom}:${activePeerId}:`)) {
          pendingSubscriberCandidates.delete(key);
        }
      }

      roomBroker.removePeer(activeRoom, activePeerId);
      socket.to(activeRoom).emit('sfu:peer-left', { peerId: activePeerId });
      socket.leave(activeRoom);
      logger.info(`[Signaling] Peer ${activePeerId} left room ${activeRoom}`);
      currentRoom = null;
      currentPeerId = null;
    }
  };

    socket.on('sfu:join', async ({ roomCode, peerId, name }: JoinPayload) => {
      if (!roomCode) {
        socket.emit('sfu:error', { message: 'roomCode is required' });
        return;
      }

      if (!socket.data.user?.isAuthenticated) {
        logger.warn(`[Signaling] Rejecting unauthenticated SFU join from socket ${socket.id}`);
        socket.emit('sfu:error', { message: 'Authentication required to join SFU room' });
        return;
      }

    const effectivePeerId = socket.data.user.id || peerId;
    const effectiveName = socket.data.user.name || name || 'Participant';

    const permCheck = await canUserJoinMeeting(effectivePeerId, roomCode);
    if (!permCheck.allowed) {
      logger.warn(`[Signaling] Rejecting unauthorized SFU join: user=${effectivePeerId}, room=${roomCode}, reason=${permCheck.reason}`);
      socket.emit('sfu:error', { message: permCheck.reason || 'Access denied to this meeting' });
      return;
    }

      if (currentRoom) {
        handleLeave();
      }

      const existingRoom = roomBroker.getRoom(roomCode);
      const existingPeer = existingRoom?.peers.get(effectivePeerId);
      if (existingPeer && existingPeer.socketId && existingPeer.socketId !== socket.id) {
        io.to(existingPeer.socketId).emit('sfu:replaced', {
          roomCode,
          peerId: effectivePeerId,
          message: 'Session replaced by another connection',
        });
        existingPeer.socketId = socket.id;
      }

      currentRoom = roomCode;
      currentPeerId = effectivePeerId;

      try {
        const assignedWorker = await RoomSharder.getInstance().getOrAssignWorker(roomCode);
        logger.info(`[Signaling] Room ${roomCode} coordinated on ${assignedWorker} for peer ${effectivePeerId}`);
      } catch (shardingErr) {
        logger.warn(`[Signaling] Room sharder coordination warning:`, shardingErr);
      }

      socket.join(roomCode);
      roomBroker.addPeer(roomCode, effectivePeerId, socket.id, effectiveName);

      const existingTracks = roomBroker.getRoomTracks(roomCode).map((t) => ({
        trackId: t.trackId,
        kind: t.kind,
        peerId: t.peerId,
      }));

      socket.emit('sfu:joined', { existingTracks });
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
    let pc: RTCPeerConnection | null = null;
    let activeRoom: string | null = null;
    let activePeerId: string | null = null;
    try {
      activeRoom = currentRoom;
      activePeerId = currentPeerId;
      const rCode = roomCode || activeRoom;
      const pId = peerId || activePeerId;
      if (!activeRoom || rCode !== activeRoom || !activePeerId || pId !== activePeerId) {
        logger.warn(`[Signaling] Unauthorized sfu:offer from socket ${socket.id} for room ${rCode} peer ${pId}`);
        socket.emit('sfu:error', { message: 'Unauthorized room or peer for offer' });
        return;
      }

      const resolvedRoom: string = activeRoom;
      const resolvedPeerId: string = activePeerId;

      const room = roomBroker.getOrCreateRoom(resolvedRoom);
      const peer = room.peers.get(resolvedPeerId);

      if (!peer) {
        logger.error(`[Signaling] Peer ${resolvedPeerId} not found in room ${resolvedRoom}`);
        return;
      }

      if (peer.peerConnection) {
        try {
          const oldTrackIds = Array.from(peer.publishedTracks.keys());
          for (const oldTrackId of oldTrackIds) {
            const closed = subscriberRegistry.removeByRoomAndTrack(resolvedRoom, oldTrackId);
            for (const subPc of closed) {
              try {
                subPc.close();
              } catch {}
            }
            roomBroker.unpublishTrack(resolvedRoom, resolvedPeerId, oldTrackId);
            socket.to(resolvedRoom).emit('sfu:track-unpublished', { peerId: resolvedPeerId, trackId: oldTrackId });
          }
          (peer.peerConnection as any).close();
        } catch (err) {
          logger.warn(`[Signaling] Error cleaning up previous publisher peerConnection for ${resolvedPeerId}:`, err);
        }
        peer.peerConnection = undefined;
        peer.inboundSrtpSession = undefined;
        peer.outboundSrtpSession = undefined;
      }

      pc = createPeerConnection();
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
              roomBroker.attachPublisherSrtpSessions(resolvedRoom, resolvedPeerId, inboundSession, outboundSession);
              logger.info(`[Signaling] Publisher DTLS connected and SRTP sessions attached for peer ${resolvedPeerId}`);
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
        const publishedTrack = roomBroker.publishTrack(resolvedRoom, resolvedPeerId, track);

        socket.to(resolvedRoom).emit('sfu:new-producer', {
          peerId: resolvedPeerId,
          trackId: publishedTrack.trackId,
          kind: publishedTrack.kind,
        });
      });

      pc.onIceCandidate.subscribe((candidate) => {
        if (candidate) {
          socket.emit('sfu:ice-candidate', {
            roomCode: resolvedRoom,
            peerId: resolvedPeerId,
            target: 'publisher',
            candidate: candidate.toJSON ? candidate.toJSON() : candidate,
          });
        }
      });

      await pc.setRemoteDescription(new RTCSessionDescription(sdp.sdp, sdp.type));

      const pubQueueKey = `${resolvedRoom}:${resolvedPeerId}`;
      const queuedPubCandidates = pendingPublisherCandidates.get(pubQueueKey) || [];
      pendingPublisherCandidates.delete(pubQueueKey);
      for (const cand of queuedPubCandidates) {
        try {
          await pc.addIceCandidate(cand);
          logger.debug(`[Signaling] Added queued publisher ICE candidate for peer ${activePeerId} in room ${activeRoom}`);
        } catch (candErr) {
          logger.warn(`[Signaling] Failed to add queued publisher ICE candidate for peer ${activePeerId} in room ${activeRoom}:`, candErr);
        }
      }

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
      logger.error(`[Signaling] Error handling offer from peer ${activePeerId || currentPeerId}:`, err);
      if (activeRoom && activePeerId) {
        const room = roomBroker.getRoom(activeRoom);
        const peer = room?.peers.get(activePeerId);
        if (peer && pc && peer.peerConnection === pc) {
          try {
            const failedTracks = Array.from(peer.publishedTracks.keys());
            for (const tId of failedTracks) {
              const closed = subscriberRegistry.removeByRoomAndTrack(activeRoom, tId);
              for (const subPc of closed) {
                try {
                  subPc.close();
                } catch {}
              }
              roomBroker.unpublishTrack(activeRoom, activePeerId, tId);
              socket.to(activeRoom).emit('sfu:track-unpublished', { peerId: activePeerId, trackId: tId });
            }
            (pc as any).close();
          } catch (cleanErr) {
            logger.warn(`[Signaling] Error cleaning up failed offer connection for ${activePeerId}:`, cleanErr);
          }
          peer.peerConnection = undefined;
          peer.inboundSrtpSession = undefined;
          peer.outboundSrtpSession = undefined;
          pendingPublisherCandidates.delete(`${activeRoom}:${activePeerId}`);
        }
      }
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
        if (consumerPc && consumerPc.remoteDescription) {
          try {
            await consumerPc.addIceCandidate(candidate);
            logger.debug(`[Signaling] Added subscriber ICE candidate for track ${trackId} in room ${activeRoom}`);
          } catch (err) {
            logger.warn(`[Signaling] Failed to add subscriber ICE candidate for room ${activeRoom} track ${trackId}:`, err);
          }
          return;
        } else {
          const queueKey = `${activeRoom}:${activePeerId}:${trackId}`;
          const queue = pendingSubscriberCandidates.get(queueKey) || [];
          queue.push(candidate);
          pendingSubscriberCandidates.set(queueKey, queue);
          return;
        }
      } else if (target === 'subscriber') {
        const allSubs = subscriberRegistry.getEntriesByRoomAndPeer(activeRoom, activePeerId);
        for (const { trackId: subTrackId, pc } of allSubs) {
          if (pc && pc.remoteDescription) {
            pc.addIceCandidate(candidate).catch((err: any) => {
              logger.warn(`[Signaling] Failed to add subscriber ICE candidate for room ${activeRoom} track ${subTrackId}:`, err);
            });
          } else {
            const queueKey = `${activeRoom}:${activePeerId}:${subTrackId}`;
            const queue = pendingSubscriberCandidates.get(queueKey) || [];
            queue.push(candidate);
            pendingSubscriberCandidates.set(queueKey, queue);
          }
        }
        return;
      }

      if (target === 'publisher' || !target) {
        const room = roomBroker.getOrCreateRoom(activeRoom);
        const peer = room.peers.get(activePeerId);
        if (peer?.peerConnection && peer.peerConnection.remoteDescription) {
          try {
            await peer.peerConnection.addIceCandidate(candidate);
            logger.debug(`[Signaling] Added publisher ICE candidate for peer ${activePeerId} in room ${activeRoom}`);
          } catch (err) {
            logger.warn(`[Signaling] Failed to add publisher ICE candidate for peer ${activePeerId} in room ${activeRoom}:`, err);
          }
          return;
        } else if (target === 'publisher') {
          const queueKey = `${activeRoom}:${activePeerId}`;
          const queue = pendingPublisherCandidates.get(queueKey) || [];
          queue.push(candidate);
          pendingPublisherCandidates.set(queueKey, queue);
          return;
        }
      }

      const allPeerSubs = subscriberRegistry.getEntriesByRoomAndPeer(activeRoom, activePeerId);
      for (const { trackId: subTrackId, pc } of allPeerSubs) {
        if (pc && pc.remoteDescription) {
          pc.addIceCandidate(candidate).catch((err: any) => {
            logger.warn(`[Signaling] Failed to add fallback subscriber ICE candidate for room ${activeRoom} track ${subTrackId}:`, err);
          });
        } else {
          const queueKey = `${activeRoom}:${activePeerId}:${subTrackId}`;
          const queue = pendingSubscriberCandidates.get(queueKey) || [];
          queue.push(candidate);
          pendingSubscriberCandidates.set(queueKey, queue);
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
      const consumerPc = subscriberRegistry.get(activeRoom, activePeerId, trackId);
      if (consumerPc && consumerPc.remoteDescription) {
        try {
          await consumerPc.addIceCandidate(candidate);
          logger.debug(`[Signaling] Added subscriber ICE candidate via sfu:subscribe-ice-candidate for track ${trackId} in room ${activeRoom}`);
        } catch (err) {
          logger.warn(`[Signaling] Failed to add subscriber ICE candidate for room ${activeRoom} track ${trackId}:`, err);
        }
      } else {
        const queueKey = `${activeRoom}:${activePeerId}:${trackId}`;
        const queue = pendingSubscriberCandidates.get(queueKey) || [];
        queue.push(candidate);
        pendingSubscriberCandidates.set(queueKey, queue);
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

        const subQueueKey = `${activeRoom}:${activePeerId}:${trackId}`;
        const queuedSubCandidates = pendingSubscriberCandidates.get(subQueueKey) || [];
        pendingSubscriberCandidates.delete(subQueueKey);
        for (const cand of queuedSubCandidates) {
          try {
            await consumerPc.addIceCandidate(cand);
            logger.debug(`[Signaling] Added queued subscriber ICE candidate for peer ${activePeerId} track ${trackId} in room ${activeRoom}`);
          } catch (candErr) {
            logger.warn(`[Signaling] Failed to add queued subscriber ICE candidate for peer ${activePeerId} track ${trackId} in room ${activeRoom}:`, candErr);
          }
        }

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

        const dtlsTransports = (consumerPc as any).dtlsTransports || [];
        logger.info(`[Signaling] Subscriber PC for peer ${activePeerId} track ${trackId} has ${dtlsTransports.length} DTLS transports | PC.connectionState=${(consumerPc as any).connectionState || 'N/A'} | PC.iceConnectionState=${(consumerPc as any).iceConnectionState || 'N/A'}`);

        if (dtlsTransports.length === 0) {
          logger.warn(`[Signaling] ⚠️ No DTLS transports found for subscriber ${activePeerId} track ${trackId}! Marking ready immediately as fallback.`);
          roomBroker.markSubscriberReady(activeRoom, activePeerId, trackId);
          if (publishedTrack.kind === 'video') {
            setTimeout(() => {
              roomBroker.requestKeyframe(activeRoom, publishedTrack.peerId, trackId);
            }, 1000);
          }
        }

        for (const dtlsTransport of dtlsTransports) {
          logger.info(`[Signaling] DTLS transport state for sub ${activePeerId} track ${trackId}: ${dtlsTransport.state}`);
          
          const onSubscriberDtlsConnected = () => {
            try {
              logger.info(`[Signaling] 🔗 Subscriber DTLS connected! Marking ready for peer ${activePeerId} on track ${trackId}`);
              roomBroker.markSubscriberReady(activeRoom, activePeerId, trackId);
              if (publishedTrack.kind === 'video') {
                roomBroker.requestKeyframe(activeRoom, publishedTrack.peerId, trackId);
                // Extra keyframe requests with delays
                setTimeout(() => roomBroker.requestKeyframe(activeRoom, publishedTrack.peerId, trackId), 1000);
                setTimeout(() => roomBroker.requestKeyframe(activeRoom, publishedTrack.peerId, trackId), 3000);
              }
              logger.info(`[Signaling] Subscriber DTLS connected and subscriber marked ready for peer ${activePeerId} on track ${trackId}`);
            } catch (err) {
              logger.error(`[Signaling] Error in onSubscriberDtlsConnected:`, err);
            }
          };

          if (dtlsTransport.state === 'connected') {
            onSubscriberDtlsConnected();
          } else {
            dtlsTransport.onStateChange.subscribe((state: string) => {
              logger.info(`[Signaling] Subscriber DTLS state changed to '${state}' for peer ${activePeerId} track ${trackId}`);
              if (state === 'connected') {
                onSubscriberDtlsConnected();
              }
            });
          }
        }

        consumerPc.connectionStateChange.subscribe((state: string) => {
          logger.info(`[Signaling] Subscriber PC connection state changed to '${state}' for peer ${activePeerId} track ${trackId}`);
          if (state === 'connected') {
            roomBroker.markSubscriberReady(activeRoom, activePeerId, trackId);
          }
        });

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
        pendingSubscriberCandidates.delete(`${activeRoom}:${activePeerId}:${trackId}`);
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
    pendingSubscriberCandidates.delete(`${activeRoom}:${activePeerId}:${trackId}`);
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

    for (const key of pendingSubscriberCandidates.keys()) {
      if (key.startsWith(`${activeRoom}:`) && key.endsWith(`:${trackId}`)) {
        pendingSubscriberCandidates.delete(key);
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
