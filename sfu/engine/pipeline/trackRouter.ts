import { EventEmitter } from 'events';
import { Publisher } from '../publisher.js';
import { RtpForwarder, RtpForwarderStats } from '../rtpForwarder.js';
import { Subscriber } from '../subscriber.js';
import logger from '../../../utils/logger.js';
import {
  PublishedTrackInfo,
  TrackRouterStats,
  TrackPublishedEvent,
  TrackUnpublishedEvent,
  SubscriptionEvent,
  UnsubscriptionEvent
} from './trackTypes.js';
import { PeerSubscriptionRegistry } from './peerSubscriptions.js';

export {
  PublishedTrackInfo,
  TrackRouterStats,
  TrackPublishedEvent,
  TrackUnpublishedEvent,
  SubscriptionEvent,
  UnsubscriptionEvent
} from './trackTypes.js';

export class TrackRouter extends EventEmitter {
  public readonly roomCode: string;
  private forwarders: Map<string, RtpForwarder> = new Map();
  private publishers: Map<string, Publisher> = new Map();
  private trackOwners: Map<string, string> = new Map();
  private peerPublishedTracks: Map<string, Set<string>> = new Map();
  private subscriptions: PeerSubscriptionRegistry = new PeerSubscriptionRegistry();
  private isClosed: boolean = false;

  constructor(roomCode: string) {
    super();
    this.roomCode = roomCode;
  }

  public addPublisher(publisher: Publisher, trackId?: string): RtpForwarder {
    if (this.isClosed) {
      throw new Error(`TrackRouter for room ${this.roomCode} is closed`);
    }

    const effectiveTrackId = trackId || publisher.id;
    if (this.forwarders.has(effectiveTrackId)) {
      return this.forwarders.get(effectiveTrackId)!;
    }

    const forwarder = new RtpForwarder(publisher);
    this.forwarders.set(effectiveTrackId, forwarder);
    this.publishers.set(effectiveTrackId, publisher);
    this.trackOwners.set(effectiveTrackId, publisher.peerId);

    let peerTracks = this.peerPublishedTracks.get(publisher.peerId);
    if (!peerTracks) {
      peerTracks = new Set();
      this.peerPublishedTracks.set(publisher.peerId, peerTracks);
    }
    peerTracks.add(effectiveTrackId);

    const onPublisherClose = () => {
      this.removePublisher(effectiveTrackId);
    };
    publisher.once('close', onPublisherClose);

    const event: TrackPublishedEvent = {
      roomCode: this.roomCode,
      trackId: effectiveTrackId,
      peerId: publisher.peerId,
      kind: publisher.kind,
      ssrc: publisher.ssrc,
      payloadType: publisher.payloadType
    };
    this.emit('track-published', event);

    return forwarder;
  }

  public removePublisher(trackId: string): boolean {
    const forwarder = this.forwarders.get(trackId);
    if (!forwarder) {
      return false;
    }

    const publisher = this.publishers.get(trackId);
    const peerId = this.trackOwners.get(trackId);

    forwarder.close();
    this.forwarders.delete(trackId);
    this.publishers.delete(trackId);
    this.trackOwners.delete(trackId);

    if (peerId) {
      const peerTracks = this.peerPublishedTracks.get(peerId);
      if (peerTracks) {
        peerTracks.delete(trackId);
        if (peerTracks.size === 0) {
          this.peerPublishedTracks.delete(peerId);
        }
      }
    }

    const removedSubs = this.subscriptions.removeTrackSubscriptions(trackId);
    for (const sub of removedSubs) {
      sub.close();
    }

    const event: TrackUnpublishedEvent = {
      roomCode: this.roomCode,
      trackId,
      peerId
    };
    this.emit('track-unpublished', event);

    return true;
  }

  public addSubscription(trackId: string, subscriber: Subscriber): boolean {
    if (this.isClosed) {
      return false;
    }

    const forwarder = this.forwarders.get(trackId);
    if (!forwarder) {
      logger.warn(`Cannot subscribe: track ${trackId} not found in room ${this.roomCode}`);
      return false;
    }

    forwarder.addSubscriber(subscriber);
    this.subscriptions.addSubscriber(subscriber.peerId, trackId, subscriber);

    const onSubscriberClose = () => {
      this.removeSubscription(trackId, subscriber.id, subscriber.peerId);
    };
    subscriber.once('close', onSubscriberClose);

    const event: SubscriptionEvent = {
      roomCode: this.roomCode,
      trackId,
      subscriberPeerId: subscriber.peerId,
      subscriberId: subscriber.id
    };
    this.emit('subscribed', event);

    return true;
  }

  public removeSubscription(trackId: string, subscriberId: string, peerId?: string): boolean {
    const forwarder = this.forwarders.get(trackId);
    if (forwarder) {
      forwarder.removeSubscriber(subscriberId);
    }

    const sub = this.subscriptions.removeSubscriber(trackId, subscriberId, peerId);
    if (sub) {
      sub.close();
    }

    const event: UnsubscriptionEvent = {
      roomCode: this.roomCode,
      trackId,
      subscriberId
    };
    this.emit('unsubscribed', event);

    return true;
  }

  public getForwarder(trackId: string): RtpForwarder | undefined {
    return this.forwarders.get(trackId);
  }

  public getPublisher(trackId: string): Publisher | undefined {
    return this.publishers.get(trackId);
  }

  public getPublishedTracks(peerId?: string): PublishedTrackInfo[] {
    const results: PublishedTrackInfo[] = [];

    for (const [trackId, publisher] of this.publishers.entries()) {
      if (!peerId || publisher.peerId === peerId) {
        results.push({
          trackId,
          peerId: publisher.peerId,
          kind: publisher.kind,
          ssrc: publisher.ssrc,
          payloadType: publisher.payloadType
        });
      }
    }

    return results;
  }

  public getSubscriber(peerId: string, trackId: string): Subscriber | undefined {
    return this.subscriptions.getSubscriber(peerId, trackId);
  }

  public pauseSubscriber(peerId: string, trackId: string): boolean {
    const subscriber = this.getSubscriber(peerId, trackId);
    if (!subscriber) {
      return false;
    }
    subscriber.pause();
    return true;
  }

  public resumeSubscriber(peerId: string, trackId: string): boolean {
    const subscriber = this.getSubscriber(peerId, trackId);
    if (!subscriber) {
      return false;
    }
    subscriber.resume();
    return true;
  }

  public removePeer(peerId: string): void {
    const publishedTracks = this.peerPublishedTracks.get(peerId);
    if (publishedTracks) {
      const trackIds = Array.from(publishedTracks);
      for (const trackId of trackIds) {
        this.removePublisher(trackId);
      }
      this.peerPublishedTracks.delete(peerId);
    }

    const removedSubs = this.subscriptions.removePeer(peerId);
    for (const sub of removedSubs) {
      const forwarder = this.forwarders.get(sub.id);
      if (forwarder) {
        forwarder.removeSubscriber(sub.id);
      }
      sub.close();
    }

    this.emit('peer-removed', {
      roomCode: this.roomCode,
      peerId
    });
  }

  public getStats(): TrackRouterStats {
    const forwardersStats: Record<string, RtpForwarderStats> = {};
    let totalSubscribers = 0;

    for (const [trackId, forwarder] of this.forwarders.entries()) {
      const stats = forwarder.getStats();
      forwardersStats[trackId] = stats;
      totalSubscribers += stats.activeSubscribers;
    }

    return {
      roomCode: this.roomCode,
      activeTracksCount: this.forwarders.size,
      publishersCount: this.publishers.size,
      totalSubscribersCount: totalSubscribers,
      forwardersStats
    };
  }

  public close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;

    for (const forwarder of this.forwarders.values()) {
      forwarder.close();
    }
    this.forwarders.clear();

    for (const publisher of this.publishers.values()) {
      publisher.close();
    }
    this.publishers.clear();

    this.subscriptions.clear();
    this.trackOwners.clear();
    this.peerPublishedTracks.clear();

    this.emit('close', { roomCode: this.roomCode });
    this.removeAllListeners();
  }
}
