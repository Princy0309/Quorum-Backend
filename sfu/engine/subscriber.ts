import { EventEmitter } from 'events';
import { SrtpSession } from '../protocols/srtp/srtpPacket.js';
import { IRtpSubscriber } from './rtpForwarder.js';

export type MediaKind = 'audio' | 'video';

export type PacketTransportSender = (packet: Buffer) => boolean | void | Promise<any>;

export type SubscriberLifecycleState = 'pending' | 'ready' | 'closed';

export interface SubscriberOptions {
  id: string;
  peerId: string;
  kind: MediaKind;
  trackId?: string;
  outboundSsrc?: number;
  payloadType?: number;
  srtpSession?: SrtpSession;
  requireSrtp?: boolean;
  transportSender?: PacketTransportSender;
  rtcpTransportSender?: PacketTransportSender;
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
  public readonly requireSrtp: boolean;
  public isPaused: boolean = false;
  private lifecycleState: SubscriberLifecycleState = 'pending';
  private srtpSession: SrtpSession | null = null;
  private transportSender: PacketTransportSender | null = null;
  private rtcpTransportSender: PacketTransportSender | null = null;
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
    this.requireSrtp = options.requireSrtp ?? false;
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
    if (options.rtcpTransportSender) {
      this.rtcpTransportSender = options.rtcpTransportSender;
    }
  }

  public setExtensionMap(map: Map<number, number> | Record<number, number>): void {
    this.extensionMap.clear();
    const entries: [number, number][] = map instanceof Map
      ? Array.from(map.entries())
      : Object.entries(map).map(([k, v]) => [Number(k), Number(v)]);

    for (const [key, value] of entries) {
      if (!Number.isInteger(key) || key < 1 || key > 255) {
        throw new Error(`Invalid source RTP extension ID: ${key}`);
      }
      if (!Number.isInteger(value) || value < 1 || value > 255) {
        throw new Error(`Invalid target RTP extension ID: ${value}`);
      }
      this.extensionMap.set(key, value);
    }
  }

  public setSrtpSession(session: SrtpSession): void {
    this.srtpSession = session;
  }

  public setTransportSender(sender: PacketTransportSender): void {
    this.transportSender = sender;
  }

  public setRtcpTransportSender(sender: PacketTransportSender): void {
    this.rtcpTransportSender = sender;
  }

  public markReady(): void {
    if (!this.isClosed) {
      this.lifecycleState = 'ready';
      this.emit('ready');
    }
  }

  public isReady(): boolean {
    return this.lifecycleState === 'ready' && !this.isClosed;
  }

  public getLifecycleState(): SubscriberLifecycleState {
    return this.lifecycleState;
  }

  public pause(): void {
    this.isPaused = true;
    this.emit('pause');
  }

  public resume(): void {
    this.isPaused = false;
    this.emit('resume');
  }

  private rewriteHeaderExtensions(packet: Buffer): Buffer {
    if (this.extensionMap.size === 0 || packet.length < 16) {
      return packet;
    }
    const hasExtension = (packet[0] & 0x10) !== 0;
    if (!hasExtension) {
      return packet;
    }
    const csrcCount = packet[0] & 0x0f;
    const extOffset = 12 + csrcCount * 4;
    if (packet.length < extOffset + 4) {
      return packet;
    }
    const profile = packet.readUInt16BE(extOffset);
    const lengthWords = packet.readUInt16BE(extOffset + 2);
    const extEnd = extOffset + 4 + lengthWords * 4;
    if (packet.length < extEnd) {
      return packet;
    }

    const isOneByte = profile === 0xbede;
    const isTwoByte = (profile & 0xfff0) === 0x1000;
    if (!isOneByte && !isTwoByte) {
      return packet;
    }

    const items: { id: number; data: Buffer }[] = [];
    let cursor = extOffset + 4;

    if (isOneByte) {
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
        items.push({ id, data: packet.subarray(cursor + 1, cursor + 1 + len) });
        cursor += 1 + len;
      }
    } else {
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
        items.push({ id, data: packet.subarray(cursor + 2, cursor + 2 + len) });
        cursor += 2 + len;
      }
    }

    let anyIdChanged = false;
    for (const item of items) {
      const mappedId = this.extensionMap.get(item.id);
      if (mappedId !== undefined && mappedId !== item.id) {
        item.id = mappedId;
        anyIdChanged = true;
      }
    }

    if (!anyIdChanged) {
      return packet;
    }

    const mustUseTwoByte = isTwoByte || items.some((item) => item.id > 14 || item.data.length > 16 || item.data.length === 0);

    const chunks: Buffer[] = [];
    if (mustUseTwoByte) {
      for (const item of items) {
        chunks.push(Buffer.from([item.id & 0xff, item.data.length & 0xff]), item.data);
      }
      let body = Buffer.concat(chunks);
      const padLen = (4 - (body.length % 4)) % 4;
      if (padLen > 0) {
        body = Buffer.concat([body, Buffer.alloc(padLen, 0)]);
      }
      const extHeader = Buffer.alloc(4);
      extHeader.writeUInt16BE(0x1000, 0);
      extHeader.writeUInt16BE(body.length / 4, 2);
      return Buffer.concat([
        packet.subarray(0, extOffset),
        extHeader,
        body,
        packet.subarray(extEnd)
      ]);
    } else {
      for (const item of items) {
        const headerByte = ((item.id & 0x0f) << 4) | ((item.data.length - 1) & 0x0f);
        chunks.push(Buffer.from([headerByte]), item.data);
      }
      let body = Buffer.concat(chunks);
      const padLen = (4 - (body.length % 4)) % 4;
      if (padLen > 0) {
        body = Buffer.concat([body, Buffer.alloc(padLen, 0)]);
      }
      const extHeader = Buffer.alloc(4);
      extHeader.writeUInt16BE(0xbede, 0);
      extHeader.writeUInt16BE(body.length / 4, 2);
      return Buffer.concat([
        packet.subarray(0, extOffset),
        extHeader,
        body,
        packet.subarray(extEnd)
      ]);
    }
  }

  public sendRtp(packet: Buffer): boolean {
    if (this.isClosed || this.isPaused || this.lifecycleState !== 'ready' || packet.length < 12) {
      this.stats.packetsDropped++;
      return false;
    }

    if (this.requireSrtp && !this.srtpSession) {
      this.stats.packetsDropped++;
      this.emit('error', new Error('SRTP session required for subscriber transport'));
      return false;
    }

    if (!this.transportSender) {
      this.stats.packetsDropped++;
      return false;
    }

    const version = (packet[0] >> 6) & 0x03;
    if (version !== 2) {
      this.stats.packetsDropped++;
      return false;
    }

    let outgoing = Buffer.from(packet);

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

    outgoing = this.rewriteHeaderExtensions(outgoing);

    let dispatchPacket: Buffer = outgoing;
    if (this.srtpSession) {
      try {
        dispatchPacket = this.srtpSession.protect(outgoing);
      } catch (err: any) {
        this.stats.packetsDropped++;
        this.emit('error', err);
        return false;
      }
    }

    try {
      const result = this.transportSender(dispatchPacket);
      if (result instanceof Promise) {
        result.catch((err: any) => {
          this.stats.packetsDropped++;
          this.emit('error', err);
        });
      } else if (result === false) {
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

    if (this.requireSrtp && !this.srtpSession) {
      this.emit('error', new Error('SRTP session required for subscriber RTCP'));
      return false;
    }

    const sender = this.rtcpTransportSender || this.transportSender;
    if (!sender) {
      return false;
    }

    let dispatchPacket: Buffer = packet;
    if (this.srtpSession) {
      try {
        dispatchPacket = this.srtpSession.protectRtcp(packet);
      } catch (err: any) {
        this.emit('error', err);
        return false;
      }
    }

    try {
      const result = sender(dispatchPacket);
      if (result instanceof Promise) {
        result.catch((err: any) => {
          this.emit('error', err);
        });
      } else if (result === false) {
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

  public pushRtcp(plaintextBuffer: Buffer): boolean {
    if (this.isClosed || plaintextBuffer.length < 8) {
      return false;
    }
    this.emit('rtcp', plaintextBuffer, this);
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
    this.lifecycleState = 'closed';
    this.srtpSession = null;
    this.transportSender = null;
    this.rtcpTransportSender = null;
    this.emit('close');
    this.removeAllListeners();
  }
}