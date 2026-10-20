import { EventEmitter } from 'events';
import { MediaStreamTrack, RTCRtpSender, RtpPacket } from 'werift';
import type { SfuRoom, Peer, PublishedTrack, TrackSubscriber } from './types.js';
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
      payloadType: (track as any).payloadType || (track.kind === 'video' ? 96 : 111)
    });

    publisher.on('rtcp-feedback', () => {
      this.requestKeyframe(roomCode, peerId, trackId);
    });

    router.addPublisher(publisher, trackId);

    track.onReceiveRtp.subscribe((packet: RtpPacket) => {
      if (!publishedTrack.ssrc && packet.header?.ssrc) {
        publishedTrack.ssrc = packet.header.ssrc;
        (track as any).ssrc = packet.header.ssrc;
        (publisher as any).ssrc = packet.header.ssrc;
        logger.info(
          `[SFU Broker] Captured SSRC ${packet.header.ssrc} for track ${trackId} (${track.kind})`
        );
      }

      const rtpBuffer = packet.serialize ? packet.serialize() : (Buffer.isBuffer(packet) ? packet : Buffer.from((packet as any).buffer));
      publisher.emit('rtp', rtpBuffer, publisher);
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
    sender: RTCRtpSender
  ): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    let subscribers = room.channels.get(trackId);
    if (!subscribers) {
      subscribers = [];
      room.channels.set(trackId, subscribers);
    }

    const publishedTrack = this.getRoomTracks(roomCode).find((t) => t.trackId === trackId);
    const kind = publishedTrack?.kind || 'video';

    const router = this.getOrCreateRouter(roomCode);
    const subId = `${subscriberPeerId}:${trackId}`;

    const subscriber = new Subscriber({
      id: subId,
      peerId: subscriberPeerId,
      kind,
      trackId,
      transportSender: (buf: Buffer) => {
        try {
          const rtpPkt = RtpPacket.deSerialize(buf);
          sender.sendRtp(rtpPkt);
          return true;
        } catch {
          try {
            (sender as any).sendRtp(buf);
            return true;
          } catch {
            return false;
          }
        }
      }
    });

    router.addSubscription(trackId, subscriber);

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
  }

  public requestKeyframe(roomCode: string, publisherPeerId: string, trackId?: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const router = this.routers.get(roomCode);
    if (trackId && router) {
      const pub = router.getPublisher(trackId);
      const pli = Buffer.alloc(12);
      pli[0] = 0x81;
      pli[1] = 206;
      pli.writeUInt16BE(1, 2);
      pli.writeUInt32BE(0, 4);
      pli.writeUInt32BE(pub?.ssrc || 0, 8);
      router.sendRtcpFeedback(trackId, pli);
    }

    const peer = room.peers.get(publisherPeerId);
    if (!peer?.peerConnection) return;

    let videoSsrc: number | undefined;
    for (const track of peer.publishedTracks.values()) {
      if (track.kind === 'video' && track.ssrc) {
        videoSsrc = track.ssrc;
        break;
      }
    }

    const receivers = peer.peerConnection.getReceivers();
    for (const receiver of receivers) {
      if (receiver.kind === 'video') {
        const ssrc = videoSsrc || receiver.track?.ssrc || (receiver.tracks[0]?.ssrc);
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

  public removePeer(roomCode: string, peerId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const peer = room.peers.get(peerId);
    if (!peer) return;

    const router = this.routers.get(roomCode);
    if (router) {
      router.removePeer(peerId);
    }

    for (const trackId of peer.publishedTracks.keys()) {
      room.channels.delete(trackId);
      this.emit('track-unpublished', { roomCode, peerId, trackId });
    }

    for (const [trackId, subscribers] of room.channels.entries()) {
      room.channels.set(
        trackId,
        subscribers.filter((s) => s.subscriberPeerId !== peerId)
      );
    }

    if (peer.peerConnection) {
      try {
        peer.peerConnection.close();
      } catch (err) {
        logger.error(`[SFU Broker] Error closing connection for ${peerId}:`, err);
      }
    }

    room.peers.delete(peerId);
    logger.info(`[SFU Broker] Peer ${peerId} removed from room ${roomCode}`);

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
