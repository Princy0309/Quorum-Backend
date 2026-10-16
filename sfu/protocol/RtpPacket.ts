export interface ParsedRtpHeader {
  version: number;
  hasPadding: boolean;
  hasExtension: boolean;
  csrcCount: number;
  marker: boolean;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  payloadOffset: number;
}

export class RtpPacket {
  public static parseHeader(buffer: Buffer): ParsedRtpHeader {
    if (buffer.length < 12) {
      throw new Error('Invalid RTP packet: Buffer too small to contain 12-byte header');
    }

    const byte0 = buffer.readUInt8(0);
    const version = (byte0 >> 6) & 0x03;
    const hasPadding = ((byte0 >> 5) & 0x01) === 1;
    const hasExtension = ((byte0 >> 4) & 0x01) === 1;
    const csrcCount = byte0 & 0x0f;

    const byte1 = buffer.readUInt8(1);
    const marker = ((byte1 >> 7) & 0x01) === 1;
    const payloadType = byte1 & 0x7f;

    const sequenceNumber = buffer.readUInt16BE(2);
    const timestamp = buffer.readUInt32BE(4);
    const ssrc = buffer.readUInt32BE(8);

    let payloadOffset = 12 + csrcCount * 4;

    if (hasExtension && buffer.length >= payloadOffset + 4) {
      const extensionLength = buffer.readUInt16BE(payloadOffset + 2);
      payloadOffset += 4 + extensionLength * 4;
    }

    return {
      version,
      hasPadding,
      hasExtension,
      csrcCount,
      marker,
      payloadType,
      sequenceNumber,
      timestamp,
      ssrc,
      payloadOffset,
    };
  }

  public static writeSSRC(buffer: Buffer, newSsrc: number): void {
    if (buffer.length >= 12) {
      buffer.writeUInt32BE(newSsrc, 8);
    }
  }

  public static writeSequenceNumber(buffer: Buffer, newSeqNum: number): void {
    if (buffer.length >= 4) {
      buffer.writeUInt16BE(newSeqNum & 0xffff, 2);
    }
  }
}
