import { EventEmitter } from 'events';
import { SrtpSession } from '../protocols/srtp/srtpPacket.js';

export type MediaKind = 'audio' | 'video';

export type PacketTransportSender = (packet: Buffer) => boolean | void | Promise<any>;

export interface PublisherOptions {
  id: string;
  peerId: string;
  kind: MediaKind;
  ssrc: number;
  payloadType: number;
  srtpSession?: SrtpSession;
  inboundSrtpSession?: SrtpSession;
  outboundSrtpSession?: SrtpSession;
  transportSender?: PacketTransportSender;
}

export interface PublisherStats {
  packetsReceived: number;
  bytesReceived: number;
  packetsDropped: number;
  rtcpPacketsReceived: number;
  rtcpPacketsSent: number;
  lastPacketTimestamp: number;
}

export class Publisher extends EventEmitter {
  public readonly id: string;
  public readonly peerId: string;
  public readonly kind: MediaKind;
  public ssrc: number;
  public readonly payloadType: number;
  private srtpSession: SrtpSession | null = null;
  private inboundSrtpSession: SrtpSession | null = null;
  private outboundSrtpSession: SrtpSession | null = null;
  private transportSender: PacketTransportSender | null = null;
  private isClosed: boolean = false;
  private stats: PublisherStats = {
    packetsReceived: 0,
    bytesReceived: 0,
    packetsDropped: 0,
    rtcpPacketsReceived: 0,
    rtcpPacketsSent: 0,
    lastPacketTimestamp: 0
  };

  constructor(options: PublisherOptions) {
    super();
    this.id = options.id;
    this.peerId = options.peerId;
    this.kind = options.kind;
    this.ssrc = options.ssrc;
    this.payloadType = options.payloadType;
    if (options.inboundSrtpSession) {
      this.inboundSrtpSession = options.inboundSrtpSession;
      this.srtpSession = options.inboundSrtpSession;
    } else if (options.srtpSession) {
      this.inboundSrtpSession = options.srtpSession;
      this.srtpSession = options.srtpSession;
    }
    if (options.outboundSrtpSession) {
      this.outboundSrtpSession = options.outboundSrtpSession;
    }
    if (options.transportSender) {
      this.transportSender = options.transportSender;
    }
  }

  public setSrtpSession(session: SrtpSession): void {
    this.inboundSrtpSession = session;
    this.srtpSession = session;
  }

  public setInboundSrtpSession(session: SrtpSession): void {
    this.inboundSrtpSession = session;
    this.srtpSession = session;
  }

  public setOutboundSrtpSession(session: SrtpSession): void {
    this.outboundSrtpSession = session;
  }

  public setTransportSender(sender: PacketTransportSender): void {
    this.transportSender = sender;
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
    if (this.ssrc !== 0 && ssrc !== this.ssrc) {
      this.stats.packetsDropped++;
      return false;
    }
    if (this.ssrc === 0) {
      this.ssrc = ssrc;
    }

    this.stats.packetsReceived++;
    this.stats.bytesReceived += rtpBuffer.length;
    this.stats.lastPacketTimestamp = Date.now();

    this.emit('rtp', rtpBuffer, this);
    return true;
  }

  public pushRtp(rtpBuffer: Buffer): boolean {
    return this.validateAndIngestRtp(rtpBuffer);
  }

  public pushRtcp(plaintextBuffer: Buffer): boolean {
    if (this.isClosed || plaintextBuffer.length < 8) {
      this.stats.packetsDropped++;
      return false;
    }
    this.stats.rtcpPacketsReceived++;
    this.emit('rtcp', plaintextBuffer, this);
    return true;
  }

  public pushSrtp(encryptedBuffer: Buffer): boolean {
    if (this.isClosed) {
      return false;
    }

    const session = this.inboundSrtpSession || this.srtpSession;
    if (!session) {
      this.stats.packetsDropped++;
      return false;
    }

    try {
      const plaintextRtp = session.unprotect(encryptedBuffer);
      return this.validateAndIngestRtp(plaintextRtp);
    } catch {
      this.stats.packetsDropped++;
      return false;
    }
  }

  public pushSrtcp(encryptedBuffer: Buffer): boolean {
    if (this.isClosed || encryptedBuffer.length < 22) {
      this.stats.packetsDropped++;
      return false;
    }

    const session = this.inboundSrtpSession || this.srtpSession;
    if (!session) {
      this.stats.packetsDropped++;
      return false;
    }

    try {
      const plaintextRtcp = session.unprotectRtcp(encryptedBuffer);
      this.stats.rtcpPacketsReceived++;
      this.emit('rtcp', plaintextRtcp, this);
      return true;
    } catch {
      this.stats.packetsDropped++;
      return false;
    }
  }

  public sendRtcp(packet: Buffer): boolean {
    if (this.isClosed || packet.length < 8) {
      return false;
    }

    if (!this.transportSender) {
      return false;
    }

    let dispatchPacket: Buffer = packet;
    const session = this.outboundSrtpSession || this.srtpSession;
    if (session) {
      try {
        dispatchPacket = session.protectRtcp(packet);
      } catch (err: any) {
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
        return false;
      }
    }

    try {
      const result = this.transportSender(dispatchPacket);
      if (result instanceof Promise) {
        result
          .then(() => {
            this.stats.rtcpPacketsSent++;
            this.emit('rtcp-sent', packet);
          })
          .catch((err: any) => {
            if (this.listenerCount('error') > 0) {
              this.emit('error', err);
            }
          });
        return true;
      } else if (result === false) {
        return false;
      }
    } catch (err: any) {
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
      return false;
    }

    this.stats.rtcpPacketsSent++;
    this.emit('rtcp-sent', packet);
    return true;
  }

  public getStats(): PublisherStats {
    return { ...this.stats };
  }

  public close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.srtpSession = null;
    this.inboundSrtpSession = null;
    this.outboundSrtpSession = null;
    this.transportSender = null;
    this.emit('close', this);
    this.removeAllListeners();
  }
}