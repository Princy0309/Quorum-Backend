import crypto from 'crypto';
import { SrtpContext, SrtpSessionKeys } from './srtpContext.js';

interface StreamState {
  highestSeq: number;
  roc: number;
  replayWindow: bigint;
  initialized: boolean;
}

export class SrtpSession {
  private context: SrtpContext;
  private isOutbound: boolean;
  private streams: Map<number, StreamState> = new Map();

  constructor(context: SrtpContext, isOutbound: boolean = false) {
    this.context = context;
    this.isOutbound = isOutbound;
  }

  private getStreamState(ssrc: number): StreamState {
    let state = this.streams.get(ssrc);
    if (!state) {
      state = {
        highestSeq: 0,
        roc: 0,
        replayWindow: 0n,
        initialized: false
      };
      this.streams.set(ssrc, state);
    }
    return state;
  }

  public validateRtpHeader(packet: Buffer): number {
    if (packet.length < 12) {
      throw new Error('Packet smaller than minimum RTP header size');
    }

    const firstByte = packet[0];
    const version = (firstByte >> 6) & 0x03;
    if (version !== 2) {
      throw new Error('Invalid RTP version');
    }

    const csrcCount = firstByte & 0x0f;
    let headerLength = 12 + csrcCount * 4;

    if (packet.length < headerLength) {
      throw new Error('Packet truncated in CSRC list');
    }

    const hasExtension = (firstByte & 0x10) !== 0;
    if (hasExtension) {
      if (packet.length < headerLength + 4) {
        throw new Error('Packet truncated in RTP extension header');
      }
      const extensionLengthWords = packet.readUInt16BE(headerLength + 2);
      headerLength += 4 + extensionLengthWords * 4;
    }

    if (packet.length < headerLength) {
      throw new Error('Packet truncated before payload');
    }

    return headerLength;
  }

  private estimateRocAndIndex(state: StreamState, seq: number): { roc: number; packetIndex: bigint; isNewHighest: boolean; newHighestSeq: number; newRoc: number } {
    if (!state.initialized) {
      return {
        roc: 0,
        packetIndex: BigInt(seq),
        isNewHighest: true,
        newHighestSeq: seq,
        newRoc: 0
      };
    }

    let roc = state.roc;
    let newRoc = state.roc;
    let isNewHighest = false;
    let newHighestSeq = state.highestSeq;
    const diff = seq - state.highestSeq;

    if (diff > 0) {
      if (diff > 32768) {
        roc = state.roc > 0 ? state.roc - 1 : 0;
      } else {
        isNewHighest = true;
        newHighestSeq = seq;
      }
    } else {
      if (-diff > 32768) {
        roc = state.roc + 1;
        newRoc = roc;
        isNewHighest = true;
        newHighestSeq = seq;
      }
    }

    const packetIndex = (BigInt(roc) << 16n) | BigInt(seq);
    return { roc, packetIndex, isNewHighest, newHighestSeq, newRoc };
  }

  private isReplay(state: StreamState, packetIndex: bigint): boolean {
    if (!state.initialized) {
      return false;
    }
    const highestIndex = (BigInt(state.roc) << 16n) | BigInt(state.highestSeq);
    const diff = highestIndex - packetIndex;

    if (diff < 0n) {
      return false;
    }

    if (diff >= 64n) {
      return true;
    }

    const mask = 1n << diff;
    return (state.replayWindow & mask) !== 0n;
  }

  private commitState(state: StreamState, packetIndex: bigint, isNewHighest: boolean, newHighestSeq: number, newRoc: number): void {
    if (!state.initialized) {
      state.highestSeq = newHighestSeq;
      state.roc = 0;
      state.replayWindow = 1n;
      state.initialized = true;
      return;
    }

    const highestIndex = (BigInt(state.roc) << 16n) | BigInt(state.highestSeq);
    const diff = highestIndex - packetIndex;

    if (diff < 0n) {
      const shift = -diff;
      state.replayWindow = shift >= 64n ? 1n : (state.replayWindow << shift) | 1n;
      state.highestSeq = newHighestSeq;
      state.roc = newRoc;
      return;
    }

    if (diff < 64n) {
      const mask = 1n << diff;
      state.replayWindow |= mask;
    }
  }

  public unprotect(srtpPacket: Buffer): Buffer {
    if (srtpPacket.length < 22) {
      throw new Error('SRTP packet too short');
    }

    const packetWithoutTag = srtpPacket.subarray(0, srtpPacket.length - 10);
    const receivedTag = srtpPacket.subarray(srtpPacket.length - 10);

    const headerLength = this.validateRtpHeader(packetWithoutTag);
    const ssrc = packetWithoutTag.readUInt32BE(8);
    const seq = packetWithoutTag.readUInt16BE(2);
    const state = this.getStreamState(ssrc);

    const { roc, packetIndex, isNewHighest, newHighestSeq, newRoc } = this.estimateRocAndIndex(state, seq);

    const rocBuffer = Buffer.alloc(4);
    rocBuffer.writeUInt32BE(roc, 0);

    const keys: SrtpSessionKeys = this.context.getRtpKeys();
    const expectedTag = crypto
      .createHmac('sha1', keys.authKey)
      .update(Buffer.concat([packetWithoutTag, rocBuffer]))
      .digest()
      .subarray(0, 10);

    if (!crypto.timingSafeEqual(receivedTag, expectedTag)) {
      throw new Error('SRTP authentication tag mismatch');
    }

    if (this.isReplay(state, packetIndex)) {
      throw new Error('SRTP replay check failed');
    }

    const header = packetWithoutTag.subarray(0, headerLength);
    const encryptedPayload = packetWithoutTag.subarray(headerLength);

    const iv = this.context.computeRtpPacketIv(ssrc, packetIndex);
    const decipher = crypto.createCipheriv('aes-128-ctr', keys.encryptionKey, iv);
    const decryptedPayload = Buffer.concat([decipher.update(encryptedPayload), decipher.final()]);

    this.commitState(state, packetIndex, isNewHighest, newHighestSeq, newRoc);

    return Buffer.concat([header, decryptedPayload]);
  }

  public protect(rtpPacket: Buffer): Buffer {
    const headerLength = this.validateRtpHeader(rtpPacket);
    const ssrc = rtpPacket.readUInt32BE(8);
    const seq = rtpPacket.readUInt16BE(2);
    const state = this.getStreamState(ssrc);

    const { roc, packetIndex, isNewHighest, newHighestSeq, newRoc } = this.estimateRocAndIndex(state, seq);
    const header = rtpPacket.subarray(0, headerLength);
    const payload = rtpPacket.subarray(headerLength);

    const keys: SrtpSessionKeys = this.context.getRtpKeys();
    const iv = this.context.computeRtpPacketIv(ssrc, packetIndex);
    const cipher = crypto.createCipheriv('aes-128-ctr', keys.encryptionKey, iv);
    const encryptedPayload = Buffer.concat([cipher.update(payload), cipher.final()]);

    const protectedWithoutTag = Buffer.concat([header, encryptedPayload]);
    const rocBuffer = Buffer.alloc(4);
    rocBuffer.writeUInt32BE(roc, 0);

    const authTag = crypto
      .createHmac('sha1', keys.authKey)
      .update(Buffer.concat([protectedWithoutTag, rocBuffer]))
      .digest()
      .subarray(0, 10);

    this.commitState(state, packetIndex, isNewHighest, newHighestSeq, newRoc);

    return Buffer.concat([protectedWithoutTag, authTag]);
  }
}