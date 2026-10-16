export class RtcpPacket {
  public static createPictureLossIndication(senderSsrc: number, mediaSsrc: number): Buffer {
    const buffer = Buffer.alloc(12);

    const version = 2;
    const padding = 0;
    const feedbackMessageType = 1;
    const byte0 = (version << 6) | (padding << 5) | feedbackMessageType;
    buffer.writeUInt8(byte0, 0);

    const payloadType = 206;
    buffer.writeUInt8(payloadType, 1);

    const length = 2;
    buffer.writeUInt16BE(length, 2);

    buffer.writeUInt32BE(senderSsrc, 4);
    buffer.writeUInt32BE(mediaSsrc, 8);

    return buffer;
  }

  public static isPictureLossIndication(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;
    const byte0 = buffer.readUInt8(0);
    const version = (byte0 >> 6) & 0x03;
    const fmt = byte0 & 0x1f;
    const payloadType = buffer.readUInt8(1);

    return version === 2 && payloadType === 206 && fmt === 1;
  }
}
    