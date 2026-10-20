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
  extensionMap?: Map<number, number> | Record<number, number>;
}

export interface SubscriberStats {
  packetsSent: number;
  bytesSent: number;
  packetsDropped: number;
  rtcpPacketsSent: number;
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
  private extensionMap: Map<number, number> = new Map();
  private isClosed: boolean = false;
  private stats: SubscriberStats = {
    packetsSent: 0,
    bytesSent: 0,
    packetsDropped: 0,
    rtcpPacketsSent: 0,
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

    if (options.extensionMap) {
      this.setExtensionMap(options.extensionMap);
    }
    if (options.srtpSession) {
      this.srtpSession = options.srtpSession;
    }
    if (options.transportSender) {
      this.transportSender = options.transportSender;
    }
  }

  public setExtensionMap(map: Map<number, number> | Record<number, number>): void {
    this.extensionMap.clear();
    if (map instanceof Map) {
      for (const [key, value] of map.entries()) {
        this.extensionMap.set(key, value);
      }
    } else if (typeof map === 'object') {
      for (const [key, value] of Object.entries(map)) {
        this.extensionMap.set(Number(key), Number(value));
      }
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

  private rewriteHeaderExtensions(packet: Buffer): void {
    if (this.extensionMap.size === 0 || packet.length < 16) {
      return;
    }
    const hasExtension = (packet[0] & 0x10) !== 0;
    if (!hasExtension) {
      return;
    }
    const csrcCount = packet[0] & 0x0f;
    const extOffset = 12 + csrcCount * 4;
    if (packet.length < extOffset + 4) {
      return;
    }
    const profile = packet.readUInt16BE(extOffset);
    const lengthWords = packet.readUInt16BE(extOffset + 2);
    const extEnd = extOffset + 4 + lengthWords * 4;
    if (packet.length < extEnd) {
      return;
    }

    let cursor = extOffset + 4;
    if (profile === 0xbede) {
      while (cursor < extEnd) {
        const byte = packet[cursor];
        if (byte === 0x00) {
          cursor++;
          continue;
        }
        if (byte === 0x0f) {
          break;
        }
        const id = (byte >> 4) & 0x0f;
        const len = (byte & 0x0f) + 1;
        if (cursor + 1 + len > extEnd) {
          break;
        }
        const mappedId = this.extensionMap.get(id);
        if (mappedId !== undefined && mappedId >= 1 && mappedId <= 14) {
          packet[cursor] = ((mappedId & 0x0f) << 4) | (byte & 0x0f);
        }
        cursor += 1 + len;
      }
    } else if ((profile & 0xfff0) === 0x1000) {
      while (cursor + 2 <= extEnd) {
        const id = packet[cursor];
        if (id === 0x00) {
          cursor++;
          continue;
        }
        const len = packet[cursor + 1];
        if (cursor + 2 + len > extEnd) {
          break;
        }
        const mappedId = this.extensionMap.get(id);
        if (mappedId !== undefined && mappedId >= 1 && mappedId <= 255) {
          packet[cursor] = mappedId & 0xff;
        }
        cursor += 2 + len;
      }
    }
  }

  public sendRtp(packet: Buffer): boolean {
    if (this.isClosed || this.isPaused || packet.length < 12) {
      this.stats.packetsDropped++;
      return false;
    }

    if (!this.srtpSession || !this.transportSender) {
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

    this.rewriteHeaderExtensions(outgoing);

    let dispatchPacket: Buffer;
    try {
      dispatchPacket = this.srtpSession.protect(outgoing);
    } catch (err: any) {
      this.stats.packetsDropped++;
      this.emit('error', err);
      return false;
    }

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

    this.stats.packetsSent++;
    this.stats.bytesSent += dispatchPacket.length;
    this.stats.lastPacketTimestamp = Date.now();

    this.emit('packet', dispatchPacket);
    return true;
  }

  public sendRtcp(packet: Buffer): boolean {
    if (this.isClosed || packet.length < 8) {
      return false;
    }

    if (!this.srtpSession || !this.transportSender) {
      return false;
    }

    let dispatchPacket: Buffer;
    try {
      dispatchPacket = this.srtpSession.protectRtcp(packet);
    } catch (err: any) {
      this.emit('error', err);
      return false;
    }

    try {
      const result = this.transportSender(dispatchPacket);
      if (result === false) {
        return false;
      }
    } catch (err: any) {
      this.emit('error', err);
      return false;
    }

    this.stats.rtcpPacketsSent++;
    this.emit('rtcp-sent', packet);
    return true;
  }

  public pushSrtcp(encryptedBuffer: Buffer): boolean {
    if (this.isClosed || !this.srtpSession || encryptedBuffer.length < 22) {
      return false;
    }

    try {
      const plaintext = this.srtpSession.unprotectRtcp(encryptedBuffer);
      this.emit('rtcp', plaintext, this);
      return true;
    } catch (err: any) {
      this.emit('error', err);
      return false;
    }
  }

  public sendKeyframeRequest(targetSsrc?: number): boolean {
    const ssrc = targetSsrc ?? this.outboundSsrc ?? 0;
    const pli = Buffer.alloc(12);
    pli[0] = 0x81;
    pli[1] = 206;
    pli.writeUInt16BE(1, 2);
    pli.writeUInt32BE(0, 4);
    pli.writeUInt32BE(ssrc, 8);
    return this.sendRtcp(pli);
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