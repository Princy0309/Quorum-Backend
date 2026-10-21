import { EventEmitter } from 'events';
import { Publisher } from '../publisher.js';
import { RtpForwarder, type RtpForwarderStats } from '../rtpForwarder.js';
import { Subscriber } from '../subscriber.js';
import logger from '../../../utils/logger.js';
import type {
  PublishedTrackInfo,
  TrackRouterStats,
  TrackPublishedEvent,
  TrackUnpublishedEvent,
  SubscriptionEvent,
  UnsubscriptionEvent,
  SubscriberErrorEvent,
  PublisherErrorEvent
} from './trackTypes.js';
import { PeerSubscriptionRegistry } from './peerSubscriptions.js';

export type {
  PublishedTrackInfo,
  TrackRouterStats,
  TrackPublishedEvent,
  TrackUnpublishedEvent,
  SubscriptionEvent,
  UnsubscriptionEvent,
  SubscriberErrorEvent,
  PublisherErrorEvent
};

export class TrackRouter extends EventEmitter {
  public readonly roomCode: string;
  private forwarders: Map<string, RtpForwarder> = new Map();
  private publishers: Map<string, Publisher> = new Map();
  private trackOwners: Map<string, string> = new Map();
  private peerPublishedTracks: Map<string, Set<string>> = new Map();
  private subscriptions: PeerSubscriptionRegistry = new PeerSubscriptionRegistry();
  private publisherListeners: Map<string, { closeListener: () => void; errorListener: (err: any) => void }> = new Map();
  private subscriberListeners: Map<string, { subscriber: Subscriber; closeListener: () => void; rtcpListener: (packet: Buffer) => void; errorListener: (err: any) => void }> = new Map();
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
    const existingPublisher = this.publishers.get(effectiveTrackId);
    if (existingPublisher) {
      if (existingPublisher === publisher || (existingPublisher.id === publisher.id && existingPublisher.peerId === publisher.peerId)) {
        return this.forwarders.get(effectiveTrackId)!;
      }
      throw new Error(`Track ${effectiveTrackId} already registered by peer ${existingPublisher.peerId}`);
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
      const currentPub = this.publishers.get(effectiveTrackId);
      if (currentPub === publisher) {
        this.removePublisher(effectiveTrackId, publisher);
      }
    };
    const onPublisherError = (err: any) => {
      logger.warn(`Publisher error in room ${this.roomCode} for peer ${publisher.peerId} track ${effectiveTrackId}:`, err);
      this.emit('publisher-error', {
        roomCode: this.roomCode,
        trackId: effectiveTrackId,
        peerId: publisher.peerId,
        error: err
      });
    };
    publisher.once('close', onPublisherClose);
    publisher.on('error', onPublisherError);
    this.publisherListeners.set(effectiveTrackId, {
      closeListener: onPublisherClose,
      errorListener: onPublisherError
    });

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

  public removePublisher(trackId: string, expectedPublisher?: Publisher): boolean {
    const forwarder = this.forwarders.get(trackId);
    if (!forwarder) {
      return false;
    }

    const publisher = this.publishers.get(trackId);
    if (!publisher) {
      return false;
    }

    if (expectedPublisher && publisher !== expectedPublisher) {
      return false;
    }

    const listeners = this.publisherListeners.get(trackId);
    if (listeners) {
      publisher.removeListener('close', listeners.closeListener);
      publisher.removeListener('error', listeners.errorListener);
      this.publisherListeners.delete(trackId);
    }

    const peerId = this.trackOwners.get(trackId);

    forwarder.close();
    publisher.close();
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
      const subKey = `${trackId}:${sub.id}`;
      const entry = this.subscriberListeners.get(subKey);
      if (entry) {
        entry.subscriber.removeListener('close', entry.closeListener);
        entry.subscriber.removeListener('rtcp', entry.rtcpListener);
        entry.subscriber.removeListener('error', entry.errorListener);
        this.subscriberListeners.delete(subKey);
      }
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

    const existingSub = this.subscriptions.getSubscriber(subscriber.peerId, trackId);
    if (existingSub) {
      if (existingSub.id === subscriber.id) {
        return true;
      }
      const existingKey = `${trackId}:${existingSub.id}`;
      const existingEntry = this.subscriberListeners.get(existingKey);
      if (existingEntry) {
        existingEntry.subscriber.removeListener('close', existingEntry.closeListener);
        existingEntry.subscriber.removeListener('rtcp', existingEntry.rtcpListener);
        existingEntry.subscriber.removeListener('error', existingEntry.errorListener);
        this.subscriberListeners.delete(existingKey);
      }
      forwarder.removeSubscriber(existingSub.id);
      existingSub.close();
    }

    forwarder.addSubscriber(subscriber);
    this.subscriptions.addSubscriber(subscriber.peerId, trackId, subscriber);

    const subKey = `${trackId}:${subscriber.id}`;
    const onSubscriberClose = () => {
      this.removeSubscription(trackId, subscriber.id, subscriber.peerId);
    };
    const onSubscriberRtcp = (packet: Buffer) => {
      this.sendRtcpFeedback(trackId, packet);
    };
    const onSubscriberError = (err: any) => {
      logger.warn(`Subscriber error in room ${this.roomCode} for peer ${subscriber.peerId} track ${trackId}:`, err);
      this.emit('subscriber-error', {
        roomCode: this.roomCode,
        trackId,
        subscriberPeerId: subscriber.peerId,
        subscriberId: subscriber.id,
        error: err
      });
    };
    subscriber.once('close', onSubscriberClose);
    subscriber.on('rtcp', onSubscriberRtcp);
    subscriber.on('error', onSubscriberError);
    this.subscriberListeners.set(subKey, {
      subscriber,
      closeListener: onSubscriberClose,
      rtcpListener: onSubscriberRtcp,
      errorListener: onSubscriberError
    });

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
    const sub = this.subscriptions.removeSubscriber(trackId, subscriberId, peerId);
    if (!sub) {
      return false;
    }

    const subKey = `${trackId}:${subscriberId}`;
    const entry = this.subscriberListeners.get(subKey);
    if (entry) {
      entry.subscriber.removeListener('close', entry.closeListener);
      entry.subscriber.removeListener('rtcp', entry.rtcpListener);
      entry.subscriber.removeListener('error', entry.errorListener);
      this.subscriberListeners.delete(subKey);
    }

    const forwarder = this.forwarders.get(trackId);
    if (forwarder) {
      forwarder.removeSubscriber(subscriberId);
    }

    sub.close();

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
    for (const { trackId, subscriber } of removedSubs) {
      const subKey = `${trackId}:${subscriber.id}`;
      const entry = this.subscriberListeners.get(subKey);
      if (entry) {
        entry.subscriber.removeListener('close', entry.closeListener);
        entry.subscriber.removeListener('rtcp', entry.rtcpListener);
        entry.subscriber.removeListener('error', entry.errorListener);
        this.subscriberListeners.delete(subKey);
      }
      const forwarder = this.forwarders.get(trackId);
      if (forwarder) {
        forwarder.removeSubscriber(subscriber.id);
      }
      subscriber.close();
    }

    this.emit('peer-removed', {
      roomCode: this.roomCode,
      peerId
    });
  }

  public sendRtcpFeedback(trackId: string, packet: Buffer): boolean {
    const forwarder = this.forwarders.get(trackId);
    if (!forwarder) {
      return false;
    }
    const publisher = this.publishers.get(trackId);
    if (publisher && publisher.ssrc && packet.length >= 12) {
      const pt = packet[1];
      if (pt === 205 || pt === 206) {
        packet.writeUInt32BE(publisher.ssrc >>> 0, 8);
      }
    }
    return forwarder.sendRtcpFeedback(packet);
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

    for (const { subscriber, closeListener, rtcpListener, errorListener } of this.subscriberListeners.values()) {
      subscriber.removeListener('close', closeListener);
      subscriber.removeListener('rtcp', rtcpListener);
      subscriber.removeListener('error', errorListener);
    }
    this.subscriberListeners.clear();

    for (const [trackId, publisher] of this.publishers.entries()) {
      const listeners = this.publisherListeners.get(trackId);
      if (listeners) {
        publisher.removeListener('close', listeners.closeListener);
        publisher.removeListener('error', listeners.errorListener);
      }
      publisher.close();
    }
    this.publisherListeners.clear();
    this.publishers.clear();

    for (const forwarder of this.forwarders.values()) {
      forwarder.close();
    }
    this.forwarders.clear();

    this.subscriptions.clear();
    this.trackOwners.clear();
    this.peerPublishedTracks.clear();

    this.emit('close', { roomCode: this.roomCode });
    this.removeAllListeners();
  }
}
