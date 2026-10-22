export const RTP_VERSION = 2;
export const RTP_HEADER_SIZE = 12;

export interface RtpHeader {
  version: number;
  padding: boolean;
  extension: boolean;
  csrcCount: number;
  marker: boolean;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  csrc: number[];
  extensionHeader?: {
    profile: number;
    length: number;
    value: Buffer;
  };
}

export interface RtpPacket {
  header: RtpHeader;
  payload: Buffer;
  raw: Buffer;
}

export class RtpParseError extends Error {
  constructor(message: string) {
    super(`[RTP Parser] ${message}`);
    this.name = 'RtpParseError';
  }
}

export const isRtpPacket = (buffer: Buffer): boolean => {
  if (!Buffer.isBuffer(buffer) || buffer.length < RTP_HEADER_SIZE) {
    return false;
  }
  const version = buffer.readUInt8(0) >>> 6;
  return version === RTP_VERSION;
};

export const parseRtpPacket = (buffer: Buffer): RtpPacket => {
  if (!Buffer.isBuffer(buffer) || buffer.length < RTP_HEADER_SIZE) {
    throw new RtpParseError(`Buffer too small: expected at least ${RTP_HEADER_SIZE} bytes, got ${buffer?.length ?? 0}`);
  }

  const firstByte = buffer.readUInt8(0);
  const version = firstByte >>> 6;

  if (version !== RTP_VERSION) {
    throw new RtpParseError(`Unsupported RTP version: ${version} (expected ${RTP_VERSION})`);
  }

  const padding = ((firstByte >>> 5) & 1) === 1;
  const extension = ((firstByte >>> 4) & 1) === 1;
  const csrcCount = firstByte & 0x0f;

  const secondByte = buffer.readUInt8(1);
  const marker = (secondByte >>> 7) === 1;
  const payloadType = secondByte & 0x7f;

  const sequenceNumber = buffer.readUInt16BE(2);
  const timestamp = buffer.readUInt32BE(4);
  const ssrc = buffer.readUInt32BE(8);

  let offset = RTP_HEADER_SIZE;
  const csrc: number[] = [];

  const csrcEnd = offset + csrcCount * 4;
  if (buffer.length < csrcEnd) {
    throw new RtpParseError(`Buffer truncated: CSRC list extends beyond packet length`);
  }

  for (let i = 0; i < csrcCount; i++) {
    csrc.push(buffer.readUInt32BE(offset));
    offset += 4;
  }

  let extensionHeader: RtpHeader['extensionHeader'];

  if (extension) {
    if (offset + 4 > buffer.length) {
      throw new RtpParseError('Buffer truncated: RTP extension header exceeds packet length');
    }

    const profile = buffer.readUInt16BE(offset);
    const lengthInWords = buffer.readUInt16BE(offset + 2);
    offset += 4;

    const extensionBytes = lengthInWords * 4;
    if (offset + extensionBytes > buffer.length) {
      throw new RtpParseError('Buffer truncated: RTP extension payload exceeds packet length');
    }

    const value = Buffer.from(buffer.subarray(offset, offset + extensionBytes));
    extensionHeader = { profile, length: lengthInWords, value };
    offset += extensionBytes;
  }

  let paddingLength = 0;
  if (padding) {
    if (buffer.length <= offset) {
      throw new RtpParseError('Buffer truncated: padding declared but no payload space remaining');
    }
    paddingLength = buffer.readUInt8(buffer.length - 1);
    if (paddingLength <= 0 || offset + paddingLength > buffer.length) {
      throw new RtpParseError(`Invalid RTP padding length: ${paddingLength}`);
    }
  }

  const payloadEnd = buffer.length - paddingLength;
  if (payloadEnd < offset) {
    throw new RtpParseError('Invalid packet: payload start offset exceeds payload end');
  }

  const payload = Buffer.from(buffer.subarray(offset, payloadEnd));

  return {
    header: {
      version,
      padding,
      extension,
      csrcCount,
      marker,
      payloadType,
      sequenceNumber,
      timestamp,
      ssrc,
      csrc,
      extensionHeader,
    },
    payload,
    raw: Buffer.from(buffer),
  };
};

export const serializeRtpPacket = (
  packet: Pick<RtpPacket, 'header' | 'payload'>
): Buffer => {
  const csrcCount = packet.header.csrc.length;
  let headerSize = RTP_HEADER_SIZE + csrcCount * 4;

  let extSize = 0;
  if (packet.header.extension && packet.header.extensionHeader) {
    extSize = 4 + packet.header.extensionHeader.value.length;
    headerSize += extSize;
  }

  const totalLength = headerSize + packet.payload.length;
  const buffer = Buffer.alloc(totalLength);

  let firstByte = (packet.header.version & 0x03) << 6;
  if (packet.header.padding) firstByte |= 1 << 5;
  if (packet.header.extension) firstByte |= 1 << 4;
  firstByte |= csrcCount & 0x0f;
  buffer.writeUInt8(firstByte, 0);

  let secondByte = packet.header.payloadType & 0x7f;
  if (packet.header.marker) secondByte |= 1 << 7;
  buffer.writeUInt8(secondByte, 1);

  buffer.writeUInt16BE(packet.header.sequenceNumber & 0xffff, 2);
  buffer.writeUInt32BE(packet.header.timestamp >>> 0, 4);
  buffer.writeUInt32BE(packet.header.ssrc >>> 0, 8);

  let offset = RTP_HEADER_SIZE;
  for (const csrcId of packet.header.csrc) {
    buffer.writeUInt32BE(csrcId >>> 0, offset);
    offset += 4;
  }

  if (packet.header.extension && packet.header.extensionHeader) {
    buffer.writeUInt16BE(packet.header.extensionHeader.profile, offset);
    buffer.writeUInt16BE(packet.header.extensionHeader.length, offset + 2);
    offset += 4;
    packet.header.extensionHeader.value.copy(buffer, offset);
    offset += packet.header.extensionHeader.value.length;
  }

  packet.payload.copy(buffer, offset);

  return buffer;
};
