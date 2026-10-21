import { EventEmitter } from 'events';
import { MediaStreamTrack, RTCRtpSender, RtpPacket } from 'werift';
import type { SfuRoom, Peer, PublishedTrack, TrackSubscriber } from './types.js';
import type { SrtpSession } from './protocols/srtp/srtpPacket.js';
import { TrackRouter } from './engine/pipeline/trackRouter.js';
import { Publisher } from './engine/publisher.js';
import { Subscriber } from './engine/subscriber.js';
import logger from '../utils/logger.js';

export class RoomBroker extends EventEmitter {
  private static instance: RoomBroker;
  private rooms: Map<string, SfuRoom> = new Map();
  private routers: Map<string, TrackRouter> = new Map();

  private constructor() {
    super();
  }

  public static getInstance(): RoomBroker {
    if (!RoomBroker.instance) {
      RoomBroker.instance = new RoomBroker();
    }
    return RoomBroker.instance;
  }

  public getOrCreateRouter(roomCode: string): TrackRouter {
    let router = this.routers.get(roomCode);
    if (!router) {
      router = new TrackRouter(roomCode);
      this.routers.set(roomCode, router);
    }
    return router;
  }

  public getRouter(roomCode: string): TrackRouter | undefined {
    return this.routers.get(roomCode);
  }

  public getOrCreateRoom(roomCode: string): SfuRoom {
    let room = this.rooms.get(roomCode);

    if (!room) {
      room = {
        code: roomCode,
        peers: new Map(),
        channels: new Map(),
      };
      this.rooms.set(roomCode, room);
      this.getOrCreateRouter(roomCode);
      logger.info(`[SFU Broker] Created room: ${roomCode}`);
    }

    return room;
  }

  public addPeer(roomCode: string, peerId: string, socketId: string, name?: string): Peer {
    const room = this.getOrCreateRoom(roomCode);
    let peer = room.peers.get(peerId);

    if (!peer) {
      peer = {
        id: peerId,
        name: name || '',
        socketId,
        publishedTracks: new Map(),
      };
      room.peers.set(peerId, peer);
      logger.info(`[SFU Broker] Peer ${peerId} joined SFU room ${roomCode}`);
    } else {
      peer.socketId = socketId;
    }
    return peer;
  }

  public publishTrack(
    roomCode: string,
    peerId: string,
    track: MediaStreamTrack
  ): PublishedTrack {
    const room = this.getOrCreateRoom(roomCode);
    const peer = room.peers.get(peerId);

    if (!peer) {
      throw new Error(`Peer ${peerId} not found in room ${roomCode}`);
    }

    const trackId = track.id || track.uuid;

    const publishedTrack: PublishedTrack = {
      trackId,
      kind: track.kind as 'audio' | 'video',
      peerId,
      mediaStreamTrack: track,
    };

    peer.publishedTracks.set(trackId, publishedTrack);

    if (!room.channels.has(trackId)) {
      room.channels.set(trackId, []);
    }

    const router = this.getOrCreateRouter(roomCode);
    const publisher = new Publisher({
      id: trackId,
      peerId,
      kind: track.kind as 'audio' | 'video',
      ssrc: publishedTrack.ssrc || 0,
      payloadType: (track as any).payloadType || (track.kind === 'video' ? 96 : 111),
      srtpSession: peer.inboundSrtpSession
    });

    publisher.setTransportSender((packet: Buffer) => {
      try {
        const pc = peer.peerConnection as any;
        const iceConn = pc?.iceTransports?.[0]?.connection;
        if (iceConn && typeof iceConn.send === 'function') {
          iceConn.send(packet).catch(() => {});
          return true;
        }
        if (pc && typeof pc.sendRtcp === 'function') {
          pc.sendRtcp(packet);
          return true;
        }
      } catch {
        return false;
      }
      return false;
    });

    publisher.on('rtcp-feedback', () => {
      this.requestKeyframe(roomCode, peerId, trackId);
    });

    router.addPublisher(publisher, trackId);

    track.onReceiveRtp.subscribe((packet: RtpPacket) => {
      if (!publishedTrack.ssrc && packet.header?.ssrc) {
        publishedTrack.ssrc = packet.header.ssrc;
        (track as any).ssrc = packet.header.ssrc;
        publisher.ssrc = packet.header.ssrc;
        logger.info(
          `[SFU Broker] Captured SSRC ${packet.header.ssrc} for track ${trackId} (${track.kind})`
        );
      }

      const rtpBuffer = packet.serialize ? packet.serialize() : (Buffer.isBuffer(packet) ? packet : Buffer.from((packet as any).buffer));
      publisher.pushRtp(rtpBuffer);
    });

    logger.info(
      `[SFU Broker] Published track ${trackId} (${track.kind}) by peer ${peerId} in room ${roomCode}`
    );

    this.emit('track-published', {
      roomCode,
      peerId,
      trackId,
      kind: track.kind,
    });

    return publishedTrack;
  }

  public subscribeToTrack(
    roomCode: string,
    subscriberPeerId: string,
    trackId: string,
    sender: RTCRtpSender,
    subscriberPeerConnection?: any
  ): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) {
      logger.error(`[SFU Broker] Room ${roomCode} not found for subscription`);
      return false;
    }

    const peer = room.peers.get(subscriberPeerId);
    if (!peer) {
      logger.error(`[SFU Broker] Peer ${subscriberPeerId} not found in room ${roomCode}`);
      return false;
    }

    const publishedTrack = this.getRoomTracks(roomCode).find((t) => t.trackId === trackId);
    if (!publishedTrack) {
      logger.error(`[SFU Broker] Track ${trackId} not found in room ${roomCode}`);
      return false;
    }

    const router = this.getOrCreateRouter(roomCode);
    if (!router.getPublisher(trackId)) {
      logger.error(`[SFU Broker] Publisher for track ${trackId} not found in router`);
      return false;
    }

    const kind = publishedTrack.kind || 'video';
    const subId = `${subscriberPeerId}:${trackId}`;

    const subscriber = new Subscriber({
      id: subId,
      peerId: subscriberPeerId,
      kind,
      trackId,
      requireSrtp: true,
      srtpSession: peer.outboundSrtpSession,
      transportSender: (buf: Buffer) => {
        try {
          const pc = subscriberPeerConnection || (sender as any).peerConnection;
          const iceConn = pc?.iceTransports?.[0]?.connection;
          if (iceConn && typeof iceConn.send === 'function') {
            return iceConn.send(buf).catch((err: any) => {
              logger.debug(`[SFU Broker] UDP send failed for subscriber ${subscriberPeerId}:`, err);
              throw err;
            });
          }
          const rtpPkt = RtpPacket.deSerialize(buf);
          sender.sendRtp(rtpPkt);
          return true;
        } catch {
          return false;
        }
      },
      rtcpTransportSender: (buf: Buffer) => {
        try {
          const pc = subscriberPeerConnection || (sender as any).peerConnection;
          const iceConn = pc?.iceTransports?.[0]?.connection;
          if (iceConn && typeof iceConn.send === 'function') {
            return iceConn.send(buf).catch((err: any) => {
              logger.debug(`[SFU Broker] UDP RTCP send failed for subscriber ${subscriberPeerId}:`, err);
              throw err;
            });
          }
          if (typeof (sender as any).sendRtcp === 'function') {
            return (sender as any).sendRtcp(buf);
          }
          if (pc && typeof (pc as any).sendRtcp === 'function') {
            return (pc as any).sendRtcp(buf);
          }
          return false;
        } catch {
          return false;
        }
      }
    });

    const success = router.addSubscription(trackId, subscriber);
    if (!success) {
      logger.error(`[SFU Broker] Failed to add subscription for peer ${subscriberPeerId} to track ${trackId}`);
      subscriber.close();
      return false;
    }

    let subscribers = room.channels.get(trackId);
    if (!subscribers) {
      subscribers = [];
      room.channels.set(trackId, subscribers);
    }

    const existingIndex = subscribers.findIndex(
      (s) => s.subscriberPeerId === subscriberPeerId
    );

    if (existingIndex >= 0) {
      subscribers[existingIndex].sender = sender;
      logger.info(
        `[SFU Broker] Updated subscription for peer ${subscriberPeerId} to track ${trackId}`
      );
    } else {
      subscribers.push({ subscriberPeerId, sender });
      logger.info(
        `[SFU Broker] Peer ${subscriberPeerId} subscribed to track ${trackId}`
      );
    }

    if (kind === 'video') {
      this.requestKeyframe(roomCode, publishedTrack.peerId, trackId);
    }

    return true;
  }

  public unsubscribeFromTrack(
    roomCode: string,
    subscriberPeerId: string,
    trackId: string
  ): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const router = this.routers.get(roomCode);
    if (router) {
      const subId = `${subscriberPeerId}:${trackId}`;
      router.removeSubscription(trackId, subId, subscriberPeerId);
    }

    const subscribers = room.channels.get(trackId);
    if (subscribers) {
      room.channels.set(
        trackId,
        subscribers.filter((s) => s.subscriberPeerId !== subscriberPeerId)
      );
    }
    return true;
  }

  public markSubscriberReady(
    roomCode: string,
    subscriberPeerId: string,
    trackId: string
  ): boolean {
    const router = this.routers.get(roomCode);
    if (!router) return false;
    const sub = router.getSubscriber(subscriberPeerId, trackId);
    if (sub) {
      sub.markReady();
      return true;
    }
    return false;
  }

  public attachPublisherSrtpSessions(
    roomCode: string,
    peerId: string,
    inboundSession: SrtpSession,
    outboundSession?: SrtpSession
  ): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const peer = room.peers.get(peerId);
    if (!peer) return;
    peer.inboundSrtpSession = inboundSession;
    if (outboundSession) {
      peer.outboundSrtpSession = outboundSession;
    }

    const router = this.routers.get(roomCode);
    if (router) {
      for (const trackId of peer.publishedTracks.keys()) {
        const pub = router.getPublisher(trackId);
        if (pub) {
          pub.setSrtpSession(inboundSession);
        }
      }
    }
  }

  public attachSubscriberSrtpSession(
    roomCode: string,
    subscriberPeerId: string,
    trackId: string,
    outboundSession: SrtpSession
  ): void {
    const router = this.routers.get(roomCode);
    if (router) {
      const sub = router.getSubscriber(subscriberPeerId, trackId);
      if (sub) {
        sub.setSrtpSession(outboundSession);
      }
    }
  }

  public attachPeerSrtpSessions(
    roomCode: string,
    peerId: string,
    inboundSession: SrtpSession,
    outboundSession: SrtpSession
  ): void {
    this.attachPublisherSrtpSessions(roomCode, peerId, inboundSession, outboundSession);
  }

  public requestKeyframe(roomCode: string, publisherPeerId: string, trackId?: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const router = this.routers.get(roomCode);
    let targetSsrc = 0;
    if (trackId && router) {
      const pub = router.getPublisher(trackId);
      targetSsrc = pub?.ssrc || 0;
      const pli = Buffer.alloc(12);
      pli[0] = 0x81;
      pli[1] = 206;
      pli.writeUInt16BE(1, 2);
      pli.writeUInt32BE(0, 4);
      pli.writeUInt32BE(targetSsrc, 8);
      router.sendRtcpFeedback(trackId, pli);
    }

    const peer = room.peers.get(publisherPeerId);
    if (!peer?.peerConnection) return;

    if (!targetSsrc && trackId) {
      const published = peer.publishedTracks.get(trackId);
      if (published?.ssrc) {
        targetSsrc = published.ssrc;
      }
    }

    if (!targetSsrc) {
      for (const track of peer.publishedTracks.values()) {
        if (track.kind === 'video' && track.ssrc) {
          targetSsrc = track.ssrc;
          break;
        }
      }
    }

    const receivers = peer.peerConnection.getReceivers();
    for (const receiver of receivers) {
      if (receiver.kind === 'video') {
        const ssrc = targetSsrc || receiver.track?.ssrc || (receiver.tracks[0]?.ssrc);
        if (ssrc) {
          receiver.sendRtcpPLI(ssrc).then(() => {
            logger.info(`[SFU Broker] Sent RTCP PLI keyframe request to publisher ${publisherPeerId} (ssrc: ${ssrc})`);
          }).catch((err) => {
            logger.error(`[SFU Broker] Failed to send RTCP PLI to ${publisherPeerId}:`, err);
          });
        } else {
          logger.warn(`[SFU Broker] Cannot send RTCP PLI to ${publisherPeerId}: SSRC not yet received`);
        }
      }
    }
  }

  public getRoomTracks(roomCode: string): PublishedTrack[] {
    const room = this.rooms.get(roomCode);
    if (!room) return [];

    const tracks: PublishedTrack[] = [];
    for (const peer of room.peers.values()) {
      for (const track of peer.publishedTracks.values()) {
        tracks.push(track);
      }
    }
    return tracks;
  }

  public unpublishTrack(
    roomCode: string,
    peerId: string,
    trackId: string
  ): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const peer = room.peers.get(peerId);
    if (!peer) return false;

    if (!peer.publishedTracks.has(trackId)) {
      return false;
    }

    peer.publishedTracks.delete(trackId);
    room.channels.delete(trackId);

    const router = this.routers.get(roomCode);
    if (router) {
      router.removePublisher(trackId);
    }

    this.emit('track-unpublished', { roomCode, peerId, trackId });
    logger.info(`[SFU Broker] Track ${trackId} unpublished by peer ${peerId} in room ${roomCode}`);
    return true;
  }

  public removePeer(roomCode: string, peerId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    let peer = room.peers.get(peerId);
    let resolvedPeerId = peerId;
    if (!peer) {
      for (const [id, p] of room.peers.entries()) {
        if (p.socketId === peerId) {
          peer = p;
          resolvedPeerId = id;
          break;
        }
      }
    }
    if (!peer) return;

    const router = this.routers.get(roomCode);
    if (router) {
      router.removePeer(resolvedPeerId);
    }

    for (const trackId of peer.publishedTracks.keys()) {
      room.channels.delete(trackId);
      this.emit('track-unpublished', { roomCode, peerId: resolvedPeerId, trackId });
    }

    for (const [trackId, subscribers] of room.channels.entries()) {
      room.channels.set(
        trackId,
        subscribers.filter((s) => s.subscriberPeerId !== resolvedPeerId)
      );
    }

    if (peer.peerConnection) {
      try {
        peer.peerConnection.close();
      } catch (err) {
        logger.error(`[SFU Broker] Error closing connection for ${resolvedPeerId}:`, err);
      }
    }

    room.peers.delete(resolvedPeerId);
    logger.info(`[SFU Broker] Peer ${resolvedPeerId} removed from room ${roomCode}`);

    if (room.peers.size === 0) {
      if (router) {
        router.close();
        this.routers.delete(roomCode);
      }
      this.rooms.delete(roomCode);
      logger.info(`[SFU Broker] Disposed empty room ${roomCode}`);
    }
  }

  public removePeersByUser(roomCode: string, userId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    for (const [peerId, peer] of room.peers.entries()) {
      if (peer.id === userId) {
        this.removePeer(roomCode, peerId);
      }
    }
  }

  public closeRoom(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const router = this.routers.get(roomCode);
    if (router) {
      router.close();
      this.routers.delete(roomCode);
    }

    for (const peerId of Array.from(room.peers.keys())) {
      this.removePeer(roomCode, peerId);
    }
    this.rooms.delete(roomCode);
  }
}

export const roomBroker = RoomBroker.getInstance();
