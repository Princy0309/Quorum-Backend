import { EventEmitter } from 'events';
import { SrtpSession } from '../protocols/srtp/srtpPacket.js';

export type MediaKind = 'audio' | 'video';

export interface PublisherOptions {
  id: string;
  peerId: string;
  kind: MediaKind;
  ssrc: number;
  payloadType: number;
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
  public readonly ssrc: number;
  public readonly payloadType: number;
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
    this.ssrc = options.ssrc;
    this.payloadType = options.payloadType;
    if (options.srtpSession) {
      this.srtpSession = options.srtpSession;
    }
  }

  public setSrtpSession(session: SrtpSession): void {
    this.srtpSession = session;
  }

  private validateAndIngestRtp(rtpBuffer: Buffer): boolean {
    if (this.isClosed || rtpBuffer.length < 12) {
      this.stats.packetsDropped++;
      return false;
    }

    const version = (rtpBuffer[0] >> 6) & 0x03;
    if (version !== 2) {
      this.stats.packetsDropped++;
      return false;
    }

    const payloadType = rtpBuffer[1] & 0x7f;
    if (payloadType !== this.payloadType) {
      this.stats.packetsDropped++;
      return false;
    }

    const ssrc = rtpBuffer.readUInt32BE(8);
    if (ssrc !== this.ssrc) {
      this.stats.packetsDropped++;
      return false;
    }

    this.stats.packetsReceived++;
    this.stats.bytesReceived += rtpBuffer.length;
    this.stats.lastPacketTimestamp = Date.now();

    this.emit('rtp', rtpBuffer, this);
    return true;
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
      return this.validateAndIngestRtp(plaintextRtp);
    } catch {
      this.stats.packetsDropped++;
      return false;
    }
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