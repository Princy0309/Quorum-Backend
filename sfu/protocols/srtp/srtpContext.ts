import crypto from 'crypto';

export interface SrtpSessionKeys {
  encryptionKey: Buffer;
  authKey: Buffer;
  saltingKey: Buffer;
}

export class SrtpContext {
  private masterKey: Buffer;
  private masterSalt: Buffer;
  private srtpKeys: SrtpSessionKeys;
  private srtcpKeys: SrtpSessionKeys;

  constructor(masterKey: Buffer, masterSalt: Buffer) {
    if (masterKey.length !== 16) {
      throw new Error('SRTP master key must be 16 bytes');
    }
    if (masterSalt.length !== 14) {
      throw new Error('SRTP master salt must be 14 bytes');
    }

    this.masterKey = masterKey;
    this.masterSalt = masterSalt;

    this.srtpKeys = {
      encryptionKey: this.deriveKey(0x00, 16),
      authKey: this.deriveKey(0x01, 20),
      saltingKey: this.deriveKey(0x02, 14)
    };

    this.srtcpKeys = {
      encryptionKey: this.deriveKey(0x03, 16),
      authKey: this.deriveKey(0x04, 20),
      saltingKey: this.deriveKey(0x05, 14)
    };
  }

  private deriveKey(label: number, keyLength: number): Buffer {
    const iv = Buffer.alloc(16, 0);
    this.masterSalt.copy(iv, 0, 0, 14);
    iv[7] ^= label;

    const cipher = crypto.createCipheriv('aes-128-ctr', this.masterKey, iv);
    const zeros = Buffer.alloc(keyLength, 0);
    return Buffer.concat([cipher.update(zeros), cipher.final()]);
  }

  public getRtpKeys(): SrtpSessionKeys {
    return this.srtpKeys;
  }

  public getRtcpKeys(): SrtpSessionKeys {
    return this.srtcpKeys;
  }

  public computeRtpPacketIv(ssrc: number, packetIndex: number | bigint): Buffer {
    const iv = Buffer.alloc(16, 0);
    this.srtpKeys.saltingKey.copy(iv, 0, 0, 14);

    iv[4] ^= (ssrc >>> 24) & 0xff;
    iv[5] ^= (ssrc >>> 16) & 0xff;
    iv[6] ^= (ssrc >>> 8) & 0xff;
    iv[7] ^= ssrc & 0xff;

    const idx = BigInt(packetIndex);
    iv[8] ^= Number((idx >> 40n) & 0xffn);
    iv[9] ^= Number((idx >> 32n) & 0xffn);
    iv[10] ^= Number((idx >> 24n) & 0xffn);
    iv[11] ^= Number((idx >> 16n) & 0xffn);
    iv[12] ^= Number((idx >> 8n) & 0xffn);
    iv[13] ^= Number(idx & 0xffn);

    return iv;
  }

  public computeRtcpPacketIv(ssrc: number, index: number): Buffer {
    const iv = Buffer.alloc(16, 0);
    this.srtcpKeys.saltingKey.copy(iv, 0, 0, 14);

    iv[4] ^= (ssrc >>> 24) & 0xff;
    iv[5] ^= (ssrc >>> 16) & 0xff;
    iv[6] ^= (ssrc >>> 8) & 0xff;
    iv[7] ^= ssrc & 0xff;

    iv[10] ^= (index >>> 24) & 0xff;
    iv[11] ^= (index >>> 16) & 0xff;
    iv[12] ^= (index >>> 8) & 0xff;
    iv[13] ^= index & 0xff;

    return iv;
  }
}