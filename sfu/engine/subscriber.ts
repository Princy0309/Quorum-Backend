import { EventEmitter } from 'events';
import { SrtpSession } from '../protocols/srtp/srtpPacket.js';
import { IRtpSubscriber } from './rtpForwarder.js';

export type MediaKind = 'audio' | 'video';

export type PacketTransportSender = (packet: Buffer) => boolean | void;

export interface SubscriberOptions {
  id: string;
  peerId: string;
  kind: MediaKind;
  trackId?: string;
  outboundSsrc?: number;
  payloadType?: number;
  srtpSession?: SrtpSession;
  transportSender?: PacketTransportSender;
  rewriteSeq?: boolean;
}

export interface SubscriberStats {
  packetsSent: number;
  bytesSent: number;
  packetsDropped: number;
  lastPacketTimestamp: number;
}

export class Subscriber extends EventEmitter implements IRtpSubscriber {
  public readonly id: string;
  public readonly peerId: string;
  public readonly kind: MediaKind;
  public readonly trackId?: string;
  public readonly outboundSsrc?: number;
  public readonly payloadType?: number;
  public isPaused: boolean = false;
  private srtpSession: SrtpSession | null = null;
  private transportSender: PacketTransportSender | null = null;
  private rewriteSeq: boolean;
  private nextSeqNum: number = 0;
  private isClosed: boolean = false;
  private stats: SubscriberStats = {
    packetsSent: 0,
    bytesSent: 0,
    packetsDropped: 0,
    lastPacketTimestamp: 0
  };

  constructor(options: SubscriberOptions) {
    super();
    this.id = options.id;
    this.peerId = options.peerId;
    this.kind = options.kind;
    this.trackId = options.trackId;
    this.outboundSsrc = options.outboundSsrc;
    this.payloadType = options.payloadType;
    this.rewriteSeq = options.rewriteSeq ?? false;
    this.nextSeqNum = Math.floor(Math.random() * 65535);

    if (options.srtpSession) {
      this.srtpSession = options.srtpSession;
    }
    if (options.transportSender) {
      this.transportSender = options.transportSender;
    }
  }

  public setSrtpSession(session: SrtpSession): void {
    this.srtpSession = session;
  }

  public setTransportSender(sender: PacketTransportSender): void {
    this.transportSender = sender;
  }

  public pause(): void {
    this.isPaused = true;
    this.emit('pause');
  }

  public resume(): void {
    this.isPaused = false;
    this.emit('resume');
  }

  public sendRtp(packet: Buffer): boolean {
    if (this.isClosed || this.isPaused || packet.length < 12) {
      this.stats.packetsDropped++;
      return false;
    }

    const version = (packet[0] >> 6) & 0x03;
    if (version !== 2) {
      this.stats.packetsDropped++;
      return false;
    }

    const outgoing = Buffer.from(packet);

    if (this.payloadType !== undefined) {
      const marker = outgoing[1] & 0x80;
      outgoing[1] = marker | (this.payloadType & 0x7f);
    }

    if (this.outboundSsrc !== undefined) {
      outgoing.writeUInt32BE(this.outboundSsrc >>> 0, 8);
    }

    if (this.rewriteSeq) {
      outgoing.writeUInt16BE(this.nextSeqNum & 0xffff, 2);
      this.nextSeqNum = (this.nextSeqNum + 1) & 0xffff;
    }

    let dispatchPacket = outgoing;

    if (this.srtpSession) {
      try {
        dispatchPacket = this.srtpSession.protect(outgoing);
      } catch (err: any) {
        this.stats.packetsDropped++;
        this.emit('error', err);
        return false;
      }
    }

    if (this.transportSender) {
      try {
        const result = this.transportSender(dispatchPacket);
        if (result === false) {
          this.stats.packetsDropped++;
          return false;
        }
      } catch (err: any) {
        this.stats.packetsDropped++;
        this.emit('error', err);
        return false;
      }
    }

    this.stats.packetsSent++;
    this.stats.bytesSent += dispatchPacket.length;
    this.stats.lastPacketTimestamp = Date.now();

    this.emit('packet', dispatchPacket);
    return true;
  }

  public getStats(): SubscriberStats {
    return { ...this.stats };
  }

  public close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.srtpSession = null;
    this.transportSender = null;
    this.emit('close');
    this.removeAllListeners();
  }
}