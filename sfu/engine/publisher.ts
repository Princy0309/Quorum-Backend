import { EventEmitter } from 'events';
import { SrtpSession } from '../protocols/srtp/srtpPacket.js';

export type MediaKind = 'audio' | 'video';

export interface PublisherOptions {
  id: string;
  peerId: string;
  kind: MediaKind;
  ssrc?: number;
  payloadType?: number;
  srtpSession?: SrtpSession;
}

export interface PublisherStats {
  packetsReceived: number;
  bytesReceived: number;
  packetsDropped: number;
  lastPacketTimestamp: number;
}

export class Publisher extends EventEmitter {
  public readonly id: string;
  public readonly peerId: string;
  public readonly kind: MediaKind;
  public ssrc: number;
  public payloadType: number;
  private srtpSession: SrtpSession | null = null;
  private isClosed: boolean = false;
  private stats: PublisherStats = {
    packetsReceived: 0,
    bytesReceived: 0,
    packetsDropped: 0,
    lastPacketTimestamp: 0
  };

  constructor(options: PublisherOptions) {
    super();
    this.id = options.id;
    this.peerId = options.peerId;
    this.kind = options.kind;
    this.ssrc = options.ssrc || 0;
    this.payloadType = options.payloadType || 0;
    if (options.srtpSession) {
      this.srtpSession = options.srtpSession;
    }
  }

  public setSrtpSession(session: SrtpSession): void {
    this.srtpSession = session;
  }

  public pushSrtp(encryptedBuffer: Buffer): boolean {
    if (this.isClosed) {
      return false;
    }

    if (!this.srtpSession) {
      this.stats.packetsDropped++;
      return false;
    }

    try {
      const plaintextRtp = this.srtpSession.unprotect(encryptedBuffer);
      this.pushRtp(plaintextRtp);
      return true;
    } catch {
      this.stats.packetsDropped++;
      return false;
    }
  }

  public pushRtp(rtpBuffer: Buffer): void {
    if (this.isClosed || rtpBuffer.length < 12) {
      return;
    }

    const ssrc = rtpBuffer.readUInt32BE(8);
    const payloadType = rtpBuffer[1] & 0x7f;

    if (this.ssrc === 0) {
      this.ssrc = ssrc;
    }
    if (this.payloadType === 0) {
      this.payloadType = payloadType;
    }

    this.stats.packetsReceived++;
    this.stats.bytesReceived += rtpBuffer.length;
    this.stats.lastPacketTimestamp = Date.now();

    this.emit('rtp', rtpBuffer, this);
  }

  public getStats(): PublisherStats {
    return { ...this.stats };
  }

  public close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.emit('close', this);
    this.removeAllListeners();
  }
}