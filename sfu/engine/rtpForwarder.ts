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
  activeSubscribers: number;
}

export class RtpForwarder {
  public readonly publisher: Publisher;
  private subscribers: Map<string, IRtpSubscriber> = new Map();
  private totalForwarded: number = 0;
  private bytesForwarded: number = 0;
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
        subscriber.sendRtp(packet);
        this.totalForwarded++;
        this.bytesForwarded += packet.length;
      } catch {
        continue;
      }
    }
  }

  public getStats(): RtpForwarderStats {
    return {
      totalForwarded: this.totalForwarded,
      bytesForwarded: this.bytesForwarded,
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