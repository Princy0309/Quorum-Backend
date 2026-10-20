import net from 'net';

export const STUN_MAGIC_COOKIE = 0x2112a442;
export const STUN_HEADER_SIZE = 20;
export const STUN_TRANSACTION_ID_SIZE = 12;

export enum StunMessageType {
  BINDING_REQUEST = 0x0001,
  BINDING_RESPONSE = 0x0101,
  BINDING_ERROR_RESPONSE = 0x0111,
}

export const SUPPORTED_STUN_TYPES: Set<number> = new Set([
  StunMessageType.BINDING_REQUEST,
  StunMessageType.BINDING_RESPONSE,
  StunMessageType.BINDING_ERROR_RESPONSE,
]);

export enum StunAttributeType {
  MAPPED_ADDRESS = 0x0001,
  USERNAME = 0x0006,
  MESSAGE_INTEGRITY = 0x0008,
  ERROR_CODE = 0x0009,
  XOR_MAPPED_ADDRESS = 0x0020,
  PRIORITY = 0x0024,
  USE_CANDIDATE = 0x0025,
  FINGERPRINT = 0x8028,
  ICE_CONTROLLED = 0x8029,
  ICE_CONTROLLING = 0x802a,
}

export interface StunAttribute {
  type: number;
  length: number;
  value: Buffer;
}

export interface StunMessage {
  type: StunMessageType;
  bodyLength: number;
  magicCookie: number;
  transactionId: Buffer;
  attributes: StunAttribute[];
}

export interface XorMappedAddress {
  family: 1 | 2;
  port: number;
  address: string;
}

export class StunParseError extends Error {
  constructor(message: string) {
    super(`[STUN Parser] ${message}`);
    this.name = 'StunParseError';
  }
}

export const isStunMessage = (buffer: Buffer): boolean => {
  if (!Buffer.isBuffer(buffer) || buffer.length < STUN_HEADER_SIZE) {
    return false;
  }
  const firstByte = buffer.readUInt8(0);
  if ((firstByte & 0xc0) !== 0) {
    return false;
  }
  const magicCookie = buffer.readUInt32BE(4);
  return magicCookie === STUN_MAGIC_COOKIE;
};

export const parseStunMessage = (buffer: Buffer): StunMessage => {
  if (!Buffer.isBuffer(buffer) || buffer.length < STUN_HEADER_SIZE) {
    throw new StunParseError(`Buffer length (${buffer?.length ?? 0}) is smaller than STUN header (${STUN_HEADER_SIZE})`);
  }

  const firstByte = buffer.readUInt8(0);
  if ((firstByte & 0xc0) !== 0) {
    throw new StunParseError('First two bits of STUN message must be 00');
  }

  const rawType = buffer.readUInt16BE(0);
  if (!SUPPORTED_STUN_TYPES.has(rawType)) {
    throw new StunParseError(`Unsupported STUN message type: 0x${rawType.toString(16)}`);
  }
  const type = rawType as StunMessageType;

  const bodyLength = buffer.readUInt16BE(2);
  const magicCookie = buffer.readUInt32BE(4);
  const transactionId = Buffer.from(buffer.subarray(8, 20));

  if (magicCookie !== STUN_MAGIC_COOKIE) {
    throw new StunParseError(`Invalid magic cookie: 0x${magicCookie.toString(16)} (expected 0x${STUN_MAGIC_COOKIE.toString(16)})`);
  }

  if (bodyLength % 4 !== 0) {
    throw new StunParseError(`Declared STUN message length (${bodyLength}) is not 4-byte aligned`);
  }

  const expectedTotalLength = STUN_HEADER_SIZE + bodyLength;
  if (buffer.length !== expectedTotalLength) {
    throw new StunParseError(`Invalid datagram length: expected exactly ${expectedTotalLength} bytes, received ${buffer.length}`);
  }

  const attributes: StunAttribute[] = [];
  let offset = STUN_HEADER_SIZE;
  const end = expectedTotalLength;

  while (offset < end) {
    if (offset + 4 > end) {
      throw new StunParseError(`Truncated attribute header at byte offset ${offset}`);
    }

    const attrType = buffer.readUInt16BE(offset);
    const attrLength = buffer.readUInt16BE(offset + 2);
    offset += 4;

    const padding = (4 - (attrLength % 4)) % 4;
    const nextOffset = offset + attrLength + padding;

    if (nextOffset > end) {
      throw new StunParseError(`Attribute 0x${attrType.toString(16)} with length ${attrLength} exceeds message boundary (${end})`);
    }

    const value = Buffer.from(buffer.subarray(offset, offset + attrLength));
    attributes.push({
      type: attrType,
      length: attrLength,
      value,
    });

    offset = nextOffset;
  }

  return {
    type,
    bodyLength,
    magicCookie,
    transactionId,
    attributes,
  };
};

export const parseIpv4ToBytes = (ip: string): Buffer => {
  if (net.isIPv4(ip) === false) {
    throw new StunParseError(`Invalid IPv4 address format: ${ip}`);
  }

  const parts = ip.split('.');
  if (parts.length !== 4) {
    throw new StunParseError(`Invalid IPv4 segment count: ${ip}`);
  }

  const buf = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    if (part.length > 1 && part.startsWith('0')) {
      throw new StunParseError(`IPv4 octet contains ambiguous leading zeroes: ${part}`);
    }
    const octet = parseInt(part, 10);
    if (isNaN(octet) || octet < 0 || octet > 255) {
      throw new StunParseError(`IPv4 octet out of range (0-255): ${part}`);
    }
    buf.writeUInt8(octet, i);
  }
  return buf;
};

export const parseIpv6ToBytes = (ip: string): Buffer => {
  if (net.isIPv6(ip) === false) {
    throw new StunParseError(`Invalid IPv6 address format: ${ip}`);
  }

  let cleanIp = ip.toLowerCase();

  if (cleanIp.includes('.')) {
    const lastColon = cleanIp.lastIndexOf(':');
    if (lastColon === -1) {
      throw new StunParseError(`Invalid dual IPv6/IPv4 address format: ${ip}`);
    }
    const v4Part = cleanIp.slice(lastColon + 1);
    const v4Bytes = parseIpv4ToBytes(v4Part);
    const hex1 = ((v4Bytes[0] << 8) | v4Bytes[1]).toString(16);
    const hex2 = ((v4Bytes[2] << 8) | v4Bytes[3]).toString(16);
    cleanIp = `${cleanIp.slice(0, lastColon)}:${hex1}:${hex2}`;
  }

  const parts = cleanIp.split('::');
  if (parts.length > 2) {
    throw new StunParseError(`Invalid IPv6 address with multiple "::": ${ip}`);
  }

  let segments: string[];

  if (parts.length === 2) {
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts[1] ? parts[1].split(':') : [];

    for (const h of head) {
      if (h === '') throw new StunParseError(`Invalid empty segment in IPv6: ${ip}`);
    }
    for (const t of tail) {
      if (t === '') throw new StunParseError(`Invalid empty segment in IPv6: ${ip}`);
    }

    const missing = 8 - (head.length + tail.length);
    if (missing < 1) {
      throw new StunParseError(`IPv6 contains "::" but does not omit any segments: ${ip}`);
    }

    const middle = new Array(missing).fill('0');
    segments = [...head, ...middle, ...tail];
  } else {
    segments = cleanIp.split(':');
    if (segments.length !== 8) {
      throw new StunParseError(`IPv6 without "::" must contain exactly 8 segments: ${ip}`);
    }
    for (const s of segments) {
      if (s === '') throw new StunParseError(`Invalid empty segment in IPv6: ${ip}`);
    }
  }

  const buf = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    const val = parseInt(segments[i], 16);
    if (isNaN(val) || val < 0 || val > 0xffff) {
      throw new StunParseError(`Invalid IPv6 hexadecimal segment: ${segments[i]}`);
    }
    buf.writeUInt16BE(val, i * 2);
  }
  return buf;
};

export const encodeXorMappedAddress = (
  ip: string,
  port: number,
  transactionId: Buffer
): Buffer => {
  if (typeof port !== 'number' || port < 0 || port > 65535 || !Number.isInteger(port)) {
    throw new StunParseError(`Invalid UDP port: ${port}`);
  }

  if (!Buffer.isBuffer(transactionId) || transactionId.length !== STUN_TRANSACTION_ID_SIZE) {
    throw new StunParseError(`Transaction ID must be exactly ${STUN_TRANSACTION_ID_SIZE} bytes`);
  }

  const ipFamily = net.isIP(ip);
  if (ipFamily === 0) {
    throw new StunParseError(`Invalid IP address string: ${ip}`);
  }

  const xorPort = port ^ (STUN_MAGIC_COOKIE >>> 16);

  if (ipFamily === 4) {
    const rawIpv4 = parseIpv4ToBytes(ip);
    const xorIp = (rawIpv4.readUInt32BE(0) ^ STUN_MAGIC_COOKIE) >>> 0;

    const payload = Buffer.alloc(8);
    payload.writeUInt8(0x00, 0);
    payload.writeUInt8(0x01, 1);
    payload.writeUInt16BE(xorPort, 2);
    payload.writeUInt32BE(xorIp, 4);
    return payload;
  }

  const rawIpv6 = parseIpv6ToBytes(ip);
  const mask = Buffer.alloc(16);
  mask.writeUInt32BE(STUN_MAGIC_COOKIE, 0);
  transactionId.copy(mask, 4);

  const payload = Buffer.alloc(20);
  payload.writeUInt8(0x00, 0);
  payload.writeUInt8(0x02, 1);
  payload.writeUInt16BE(xorPort, 2);

  for (let i = 0; i < 16; i++) {
    payload.writeUInt8(rawIpv6[i] ^ mask[i], 4 + i);
  }

  return payload;
};

export const decodeXorMappedAddress = (
  attribute: StunAttribute,
  transactionId: Buffer
): XorMappedAddress => {
  if (!attribute || attribute.type !== StunAttributeType.XOR_MAPPED_ADDRESS) {
    throw new StunParseError('Attribute is not XOR-MAPPED-ADDRESS');
  }

  if (!Buffer.isBuffer(attribute.value)) {
    throw new StunParseError('Attribute value must be a Buffer');
  }

  if (!Number.isInteger(attribute.length) || attribute.length < 0) {
    throw new StunParseError('Attribute length must be a non-negative integer');
  }

  if (attribute.length !== attribute.value.length) {
    throw new StunParseError(`Attribute length (${attribute.length}) does not match Buffer length (${attribute.value.length})`);
  }

  if (!Buffer.isBuffer(transactionId) || transactionId.length !== STUN_TRANSACTION_ID_SIZE) {
    throw new StunParseError(`Transaction ID must be exactly ${STUN_TRANSACTION_ID_SIZE} bytes`);
  }

  const val = attribute.value;
  if (val.length < 4 || val.readUInt8(0) !== 0x00) {
    throw new StunParseError('Invalid XOR-MAPPED-ADDRESS: reserved first byte must be 0x00');
  }

  const familyCode = val.readUInt8(1);
  const xorPort = val.readUInt16BE(2);
  const port = xorPort ^ (STUN_MAGIC_COOKIE >>> 16);

  if (familyCode === 0x01) {
    if (val.length !== 8) {
      throw new StunParseError(`IPv4 XOR-MAPPED-ADDRESS must be exactly 8 bytes (received ${val.length})`);
    }

    const xorIp = val.readUInt32BE(4);
    const rawIpInt = (xorIp ^ STUN_MAGIC_COOKIE) >>> 0;
    const octet1 = (rawIpInt >>> 24) & 0xff;
    const octet2 = (rawIpInt >>> 16) & 0xff;
    const octet3 = (rawIpInt >>> 8) & 0xff;
    const octet4 = rawIpInt & 0xff;
    const address = `${octet1}.${octet2}.${octet3}.${octet4}`;

    return { family: 1, port, address };
  }

  if (familyCode === 0x02) {
    if (val.length !== 20) {
      throw new StunParseError(`IPv6 XOR-MAPPED-ADDRESS must be exactly 20 bytes (received ${val.length})`);
    }

    const mask = Buffer.alloc(16);
    mask.writeUInt32BE(STUN_MAGIC_COOKIE, 0);
    transactionId.copy(mask, 4);

    const segments: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      const byte1 = val.readUInt8(4 + i) ^ mask[i];
      const byte2 = val.readUInt8(5 + i) ^ mask[i + 1];
      const seg = ((byte1 << 8) | byte2).toString(16);
      segments.push(seg);
    }
    const address = segments.join(':');

    return { family: 2, port, address };
  }

  throw new StunParseError(`Unsupported address family code: 0x${familyCode.toString(16)}`);
};

export const createStunBindingResponse = (
  transactionId: Buffer,
  clientIp: string,
  clientPort: number
): Buffer => {
  const xorPayload = encodeXorMappedAddress(clientIp, clientPort, transactionId);

  const attributeHeaderSize = 4;
  const bodyLength = attributeHeaderSize + xorPayload.length;
  const totalLength = STUN_HEADER_SIZE + bodyLength;

  const response = Buffer.alloc(totalLength);

  response.writeUInt16BE(StunMessageType.BINDING_RESPONSE, 0);
  response.writeUInt16BE(bodyLength, 2);
  response.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  transactionId.copy(response, 8);

  const attrOffset = STUN_HEADER_SIZE;
  response.writeUInt16BE(StunAttributeType.XOR_MAPPED_ADDRESS, attrOffset);
  response.writeUInt16BE(xorPayload.length, attrOffset + 2);
  xorPayload.copy(response, attrOffset + 4);

  return response;
};
