import { Publisher } from './publisher.js';

export interface IRtpSubscriber {
  readonly id: string;
  readonly peerId: string;
  sendRtp(packet: Buffer): boolean | void;
  isPaused?: boolean;
}

export interface RtpForwarderStats {
  totalForwarded: number;
  bytesForwarded: number;
  failedForwarded: number;
  activeSubscribers: number;
}

export class RtpForwarder {
  public readonly publisher: Publisher;
  private subscribers: Map<string, IRtpSubscriber> = new Map();
  private totalForwarded: number = 0;
  private bytesForwarded: number = 0;
  private failedForwarded: number = 0;
  private isClosed: boolean = false;

  private onRtpHandler = (packet: Buffer) => {
    this.forwardPacket(packet);
  };

  private onPublisherCloseHandler = () => {
    this.close();
  };

  constructor(publisher: Publisher) {
    this.publisher = publisher;
    this.publisher.on('rtp', this.onRtpHandler);
    this.publisher.on('close', this.onPublisherCloseHandler);
  }

  public addSubscriber(subscriber: IRtpSubscriber): void {
    if (this.isClosed) {
      return;
    }
    this.subscribers.set(subscriber.id, subscriber);
  }

  public removeSubscriber(subscriberId: string): boolean {
    return this.subscribers.delete(subscriberId);
  }

  public getSubscribers(): IRtpSubscriber[] {
    return Array.from(this.subscribers.values());
  }

  public forwardPacket(packet: Buffer): void {
    if (this.isClosed || this.subscribers.size === 0) {
      return;
    }

    for (const subscriber of this.subscribers.values()) {
      if (subscriber.isPaused) {
        continue;
      }

      try {
        const subscriberPacket = Buffer.from(packet);
        const result = subscriber.sendRtp(subscriberPacket);
        if (result === false) {
          this.failedForwarded++;
          continue;
        }
        this.totalForwarded++;
        this.bytesForwarded += packet.length;
      } catch {
        this.failedForwarded++;
        continue;
      }
    }
  }

  public sendRtcpFeedback(packet: Buffer): boolean {
    if (this.isClosed || packet.length < 8) {
      return false;
    }
    this.publisher.emit('rtcp-feedback', packet, this);
    if (typeof (this.publisher as any).sendRtcp === 'function') {
      return (this.publisher as any).sendRtcp(packet);
    }
    return true;
  }

  public getStats(): RtpForwarderStats {
    return {
      totalForwarded: this.totalForwarded,
      bytesForwarded: this.bytesForwarded,
      failedForwarded: this.failedForwarded,
      activeSubscribers: this.subscribers.size
    };
  }

  public close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.publisher.off('rtp', this.onRtpHandler);
    this.publisher.off('close', this.onPublisherCloseHandler);
    this.subscribers.clear();
  }
}