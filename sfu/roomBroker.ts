import { EventEmitter } from 'events';
import type { MediaStreamTrack, RTCRtpSender, RtpPacket } from 'werift';
import type { SfuRoom, Peer, PublishedTrack, TrackSubscriber } from './types.js';
import logger from '../utils/logger.js';

export class RoomBroker extends EventEmitter {
  private static instance: RoomBroker;
  private rooms: Map<string, SfuRoom> = new Map();

  private constructor() {
    super();
  }

  public static getInstance(): RoomBroker {
    if (!RoomBroker.instance) {
      RoomBroker.instance = new RoomBroker();
    }
    return RoomBroker.instance;
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

    // Use track.id or fallback to track.uuid (guaranteed string)
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

    track.onReceiveRtp.subscribe((packet: RtpPacket) => {
      if (!publishedTrack.ssrc && packet.header?.ssrc) {
        publishedTrack.ssrc = packet.header.ssrc;
        (track as any).ssrc = packet.header.ssrc;
        logger.info(
          `[SFU Broker] Captured SSRC ${packet.header.ssrc} for track ${trackId} (${track.kind})`
        );
      }

      const subscribers = room.channels.get(trackId);
      if (subscribers && subscribers.length > 0) {
        for (const sub of subscribers) {
          try {
            sub.sender.sendRtp(packet);
          } catch (err) {
            logger.error(`[SFU Broker] Packet forward error:`, err);
          }
        }
      }
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

  public requestKeyframe(roomCode: string, publisherPeerId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
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
    for (const peerId of Array.from(room.peers.keys())) {
      this.removePeer(roomCode, peerId);
    }
    this.rooms.delete(roomCode);
  }
}

export const roomBroker = RoomBroker.getInstance();
