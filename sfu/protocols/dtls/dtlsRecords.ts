export const DTLS_CONTENT_TYPE = {
  CHANGE_CIPHER_SPEC: 20,
  ALERT: 21,
  HANDSHAKE: 22,
  APPLICATION_DATA: 23
} as const;

export const DTLS_HANDSHAKE_TYPE = {
  HELLO_REQUEST: 0,
  CLIENT_HELLO: 1,
  SERVER_HELLO: 2,
  HELLO_VERIFY_REQUEST: 3,
  CERTIFICATE: 11,
  SERVER_KEY_EXCHANGE: 12,
  CERTIFICATE_REQUEST: 13,
  SERVER_HELLO_DONE: 14,
  CERTIFICATE_VERIFY: 15,
  CLIENT_KEY_EXCHANGE: 16,
  FINISHED: 20
} as const;

export const SRTP_PROFILE = {
  SRTP_AES128_CM_HMAC_SHA1_80: 0x0001,
  SRTP_AES128_CM_HMAC_SHA1_32: 0x0002
} as const;

export interface DtlsRecord {
  contentType: number;
  protocolVersion: number;
  epoch: number;
  sequenceNumber: bigint;
  length: number;
  fragment: Buffer;
}

export interface DtlsHandshakeMessage {
  msgType: number;
  length: number;
  messageSeq: number;
  fragmentOffset: number;
  fragmentLength: number;
  body: Buffer;
}

export class HandshakeReassembler {
  private fragments: Map<number, {
    msgType: number;
    length: number;
    buffer: Buffer;
    receivedBytes: number;
    offsets: Set<number>;
  }> = new Map();

  public processFragment(
    msgType: number,
    length: number,
    messageSeq: number,
    fragmentOffset: number,
    fragmentLength: number,
    fragmentBody: Buffer
  ): DtlsHandshakeMessage | null {
    if (fragmentOffset + fragmentLength > length || fragmentBody.length < fragmentLength) {
      return null;
    }

    if (fragmentOffset === 0 && fragmentLength === length) {
      return {
        msgType,
        length,
        messageSeq,
        fragmentOffset: 0,
        fragmentLength: length,
        body: fragmentBody.subarray(0, length)
      };
    }

    let item = this.fragments.get(messageSeq);
    if (!item) {
      item = {
        msgType,
        length,
        buffer: Buffer.alloc(length),
        receivedBytes: 0,
        offsets: new Set()
      };
      this.fragments.set(messageSeq, item);
    }

    if (!item.offsets.has(fragmentOffset)) {
      fragmentBody.copy(item.buffer, fragmentOffset, 0, fragmentLength);
      item.receivedBytes += fragmentLength;
      item.offsets.add(fragmentOffset);
    }

    if (item.receivedBytes >= item.length) {
      this.fragments.delete(messageSeq);
      return {
        msgType: item.msgType,
        length: item.length,
        messageSeq,
        fragmentOffset: 0,
        fragmentLength: item.length,
        body: item.buffer
      };
    }

    return null;
  }

  public clear(): void {
    this.fragments.clear();
  }
}

export const parseDtlsRecords = (buffer: Buffer): DtlsRecord[] => {
  const records: DtlsRecord[] = [];
  let offset = 0;

  while (offset + 13 <= buffer.length) {
    const contentType = buffer[offset];
    if (
      contentType !== DTLS_CONTENT_TYPE.CHANGE_CIPHER_SPEC &&
      contentType !== DTLS_CONTENT_TYPE.ALERT &&
      contentType !== DTLS_CONTENT_TYPE.HANDSHAKE &&
      contentType !== DTLS_CONTENT_TYPE.APPLICATION_DATA
    ) {
      break;
    }

    const protocolVersion = buffer.readUInt16BE(offset + 1);
    const epoch = buffer.readUInt16BE(offset + 3);

    const seqHigh = BigInt(buffer.readUInt16BE(offset + 5));
    const seqLow = BigInt(buffer.readUInt32BE(offset + 7));
    const sequenceNumber = (seqHigh << 32n) | seqLow;

    const length = buffer.readUInt16BE(offset + 11);
    if (length > 16384) {
      break;
    }

    const recordEnd = offset + 13 + length;
    if (recordEnd > buffer.length) {
      break;
    }

    const fragment = buffer.subarray(offset + 13, recordEnd);
    records.push({
      contentType,
      protocolVersion,
      epoch,
      sequenceNumber,
      length,
      fragment
    });

    offset = recordEnd;
  }

  return records;
};

export const parseHandshakeMessages = (
  fragment: Buffer,
  reassembler?: HandshakeReassembler
): DtlsHandshakeMessage[] => {
  const messages: DtlsHandshakeMessage[] = [];
  let offset = 0;

  while (offset + 12 <= fragment.length) {
    const msgType = fragment[offset];
    const length = (fragment[offset + 1] << 16) | (fragment[offset + 2] << 8) | fragment[offset + 3];
    const messageSeq = fragment.readUInt16BE(offset + 4);
    const fragmentOffset = (fragment[offset + 6] << 16) | (fragment[offset + 7] << 8) | fragment[offset + 8];
    const fragmentLength = (fragment[offset + 9] << 16) | (fragment[offset + 10] << 8) | fragment[offset + 11];

    if (fragmentOffset + fragmentLength > length || length > 65535) {
      break;
    }

    const bodyEnd = offset + 12 + fragmentLength;
    if (bodyEnd > fragment.length) {
      break;
    }

    const body = fragment.subarray(offset + 12, bodyEnd);

    if (reassembler) {
      const reassembled = reassembler.processFragment(
        msgType,
        length,
        messageSeq,
        fragmentOffset,
        fragmentLength,
        body
      );
      if (reassembled) {
        messages.push(reassembled);
      }
    } else {
      if (fragmentOffset === 0 && fragmentLength === length) {
        messages.push({
          msgType,
          length,
          messageSeq,
          fragmentOffset,
          fragmentLength,
          body
        });
      }
    }

    offset = bodyEnd;
  }

  return messages;
};

export const wrapHandshakeMessage = (msgType: number, body: Buffer, messageSeq: number): Buffer => {
  const length = body.length;
  const header = Buffer.alloc(12);

  header[0] = msgType;
  header[1] = (length >> 16) & 0xff;
  header[2] = (length >> 8) & 0xff;
  header[3] = length & 0xff;

  header.writeUInt16BE(messageSeq, 4);

  header[6] = 0;
  header[7] = 0;
  header[8] = 0;

  header[9] = (length >> 16) & 0xff;
  header[10] = (length >> 8) & 0xff;
  header[11] = length & 0xff;

  return Buffer.concat([header, body]);
};

export const wrapDtlsRecord = (contentType: number, payload: Buffer, epoch: number, seq: bigint): Buffer => {
  const header = Buffer.alloc(13);

  header[0] = contentType;
  header.writeUInt16BE(0xfefd, 1);
  header.writeUInt16BE(epoch, 3);

  header.writeUInt16BE(Number((seq >> 32n) & 0xffffn), 5);
  header.writeUInt32BE(Number(seq & 0xffffffffn), 7);

  header.writeUInt16BE(payload.length, 11);

  return Buffer.concat([header, payload]);
};
