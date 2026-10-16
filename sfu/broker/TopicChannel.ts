import type { RTCRtpSender, RtpPacket as WeriftRtpPacket } from 'werift';
import type { TrackSubscriber } from '../types/sfuTypes.js';
import logger from '../../utils/logger.js';

export class TopicChannel {
  public readonly trackId: string;
  public readonly publisherPeerId: string;
  public readonly kind: 'audio' | 'video';
  public ssrc?: number;

  private subscribers: Map<string, TrackSubscriber> = new Map();
  private packetsForwarded: number = 0;
  private bytesForwarded: number = 0;

  constructor(trackId: string, publisherPeerId: string, kind: 'audio' | 'video', ssrc?: number) {
    this.trackId = trackId;
    this.publisherPeerId = publisherPeerId;
    this.kind = kind;
    this.ssrc = ssrc;
  }

  public addSubscriber(subscriberPeerId: string, sender: RTCRtpSender): void {
    this.subscribers.set(subscriberPeerId, { subscriberPeerId, sender });
    logger.info(`[TopicChannel] Peer ${subscriberPeerId} subscribed to ${this.kind} topic ${this.trackId}`);
  }

  public removeSubscriber(subscriberPeerId: string): void {
    if (this.subscribers.has(subscriberPeerId)) {
      this.subscribers.delete(subscriberPeerId);
      logger.info(`[TopicChannel] Peer ${subscriberPeerId} unsubscribed from topic ${this.trackId}`);
    }
  }

  public getSubscriberCount(): number {
    return this.subscribers.size;
  }

  public dispatchPacket(packet: WeriftRtpPacket): void {
    if (this.subscribers.size === 0) return;

    this.packetsForwarded++;
    this.bytesForwarded += packet.serialize().length;

    for (const [subId, sub] of this.subscribers.entries()) {
      try {
        sub.sender.sendRtp(packet);
      } catch (err) {
        logger.error(`[TopicChannel] Error forwarding packet to subscriber ${subId}:`, err);
      }
    }
  }

  public getStats() {
    return {
      trackId: this.trackId,
      publisherPeerId: this.publisherPeerId,
      kind: this.kind,
      subscribers: this.subscribers.size,
      packetsForwarded: this.packetsForwarded,
      bytesForwarded: this.bytesForwarded,
    };
  }

  public close(): void {
    this.subscribers.clear();
  }
}
