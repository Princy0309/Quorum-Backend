import crypto from 'crypto';
import { EventEmitter } from 'events';
import { DtlsCertificate } from './dtlsCertificate.js';
import {
  computeMasterSecret,
  exportSrtpKeyMaterial,
  SrtpKeyMaterial
} from './dtlsKeys.js';
import { SrtpContext } from '../srtp/srtpContext.js';
import { SrtpSession } from '../srtp/srtpPacket.js';
import {
  DTLS_CONTENT_TYPE,
  DTLS_HANDSHAKE_TYPE,
  SRTP_PROFILE,
  parseDtlsRecords,
  parseHandshakeMessages
} from './dtlsRecords.js';
import {
  generateDtlsCookie,
  buildHelloVerifyRequest,
  buildServerFlight4
} from './dtlsFlight.js';

export {
  DTLS_CONTENT_TYPE,
  DTLS_HANDSHAKE_TYPE,
  SRTP_PROFILE,
  DtlsRecord,
  DtlsHandshakeMessage
} from './dtlsRecords.js';

export interface DtlsHandshakeOptions {
  certificate: DtlsCertificate;
  transportSender?: (packet: Buffer) => boolean | void;
  requireCookie?: boolean;
}

export interface DtlsConnectedEvent {
  keyMaterial: SrtpKeyMaterial;
  inboundSession: SrtpSession;
  outboundSession: SrtpSession;
  profile: number;
}

export class DtlsServerHandshake extends EventEmitter {
  private certificate: DtlsCertificate;
  private transportSender: ((packet: Buffer) => boolean | void) | null = null;
  private requireCookie: boolean;
  private cookieSecret: Buffer;
  private state: 'INITIAL' | 'VERIFY_REQUESTED' | 'WAIT_CLIENT_KEY_EXCHANGE' | 'CONNECTED' | 'CLOSED' = 'INITIAL';

  private clientRandom: Buffer | null = null;
  private serverRandom: Buffer | null = null;
  private ecdh: crypto.ECDH | null = null;
  private serverHandshakeSeq: number = 0;
  private serverRecordSeq: bigint = 0n;
  private selectedProfile: number = SRTP_PROFILE.SRTP_AES128_CM_HMAC_SHA1_80;

  private masterSecret: Buffer | null = null;
  private srtpKeyMaterial: SrtpKeyMaterial | null = null;
  private inboundSession: SrtpSession | null = null;
  private outboundSession: SrtpSession | null = null;
  private cachedFlight4: Buffer | null = null;

  constructor(options: DtlsHandshakeOptions) {
    super();
    this.certificate = options.certificate;
    this.requireCookie = options.requireCookie ?? true;
    this.cookieSecret = crypto.randomBytes(16);
    if (options.transportSender) {
      this.transportSender = options.transportSender;
    }
  }

  public setTransportSender(sender: (packet: Buffer) => boolean | void): void {
    this.transportSender = sender;
  }

  public isConnected(): boolean {
    return this.state === 'CONNECTED';
  }

  public getKeyMaterial(): SrtpKeyMaterial | null {
    return this.srtpKeyMaterial;
  }

  public getInboundSession(): SrtpSession | null {
    return this.inboundSession;
  }

  public getOutboundSession(): SrtpSession | null {
    return this.outboundSession;
  }

  public getSelectedProfile(): number {
    return this.selectedProfile;
  }

  public handleIncomingDatagram(datagram: Buffer): void {
    if (this.state === 'CLOSED' || datagram.length < 13) {
      return;
    }

    const records = parseDtlsRecords(datagram);
    for (const record of records) {
      if (record.contentType === DTLS_CONTENT_TYPE.HANDSHAKE) {
        this.processHandshakeRecord(record.fragment);
      } else if (record.contentType === DTLS_CONTENT_TYPE.ALERT) {
        this.emit('alert', record.fragment);
      }
    }
  }

  private processHandshakeRecord(fragment: Buffer): void {
    const messages = parseHandshakeMessages(fragment);
    for (const msg of messages) {
      if (msg.msgType === DTLS_HANDSHAKE_TYPE.CLIENT_HELLO) {
        this.onClientHello(msg.body);
      } else if (msg.msgType === DTLS_HANDSHAKE_TYPE.CLIENT_KEY_EXCHANGE) {
        this.onClientKeyExchange(msg.body);
      }
    }
  }

  private onClientHello(body: Buffer): void {
    if (body.length < 34) {
      return;
    }

    let offset = 2;
    const clientRandom = Buffer.from(body.subarray(offset, offset + 32));
    offset += 32;

    const sessionIdLength = body[offset];
    offset += 1 + sessionIdLength;

    if (offset >= body.length) {
      return;
    }

    const cookieLength = body[offset];
    offset += 1;
    const cookie = body.subarray(offset, offset + cookieLength);
    offset += cookieLength;

    const expectedCookie = generateDtlsCookie(clientRandom, this.cookieSecret);

    if (this.requireCookie && (cookieLength === 0 || !crypto.timingSafeEqual(cookie, expectedCookie))) {
      const verify = buildHelloVerifyRequest(expectedCookie, this.serverHandshakeSeq, this.serverRecordSeq);
      this.serverHandshakeSeq = verify.nextHandshakeSeq;
      this.serverRecordSeq = verify.nextRecordSeq;
      this.dispatch(verify.record);
      this.state = 'VERIFY_REQUESTED';
      return;
    }

    if (this.state === 'WAIT_CLIENT_KEY_EXCHANGE' && this.cachedFlight4 && this.clientRandom && crypto.timingSafeEqual(this.clientRandom, clientRandom)) {
      this.dispatch(this.cachedFlight4);
      return;
    }

    this.clientRandom = clientRandom;

    if (offset + 2 <= body.length) {
      const cipherSuitesLength = body.readUInt16BE(offset);
      offset += 2 + cipherSuitesLength;
    }

    if (offset < body.length) {
      const compressionMethodsLength = body[offset];
      offset += 1 + compressionMethodsLength;
    }

    if (offset + 2 <= body.length) {
      const extensionsLength = body.readUInt16BE(offset);
      offset += 2;
      const extensionsEnd = offset + extensionsLength;

      while (offset + 4 <= extensionsEnd && offset + 4 <= body.length) {
        const extType = body.readUInt16BE(offset);
        const extLen = body.readUInt16BE(offset + 2);
        offset += 4;

        if (extType === 14 && extLen >= 2) {
          const profilesLength = body.readUInt16BE(offset);
          let pOffset = offset + 2;
          const pEnd = pOffset + profilesLength;
          while (pOffset + 2 <= pEnd && pOffset + 2 <= body.length) {
            const profile = body.readUInt16BE(pOffset);
            if (profile === SRTP_PROFILE.SRTP_AES128_CM_HMAC_SHA1_80 || profile === SRTP_PROFILE.SRTP_AEAD_AES_128_GCM) {
              this.selectedProfile = profile;
              break;
            }
            pOffset += 2;
          }
        }
        offset += extLen;
      }
    }

    const flight4 = buildServerFlight4(
      this.clientRandom,
      this.certificate,
      this.selectedProfile,
      this.serverHandshakeSeq,
      this.serverRecordSeq
    );

    this.serverRandom = flight4.serverRandom;
    this.ecdh = flight4.ecdh;
    this.serverHandshakeSeq = flight4.nextHandshakeSeq;
    this.serverRecordSeq = flight4.nextRecordSeq;
    this.cachedFlight4 = flight4.record;

    this.dispatch(flight4.record);
    this.state = 'WAIT_CLIENT_KEY_EXCHANGE';
  }

  private onClientKeyExchange(body: Buffer): void {
    if (body.length < 2 || !this.ecdh || !this.clientRandom || !this.serverRandom) {
      return;
    }

    const keyLength = body[0];
    const clientPublicKey = body.subarray(1, 1 + keyLength);

    const preMasterSecret = this.ecdh.computeSecret(clientPublicKey);
    this.masterSecret = computeMasterSecret(preMasterSecret, this.clientRandom, this.serverRandom);
    this.srtpKeyMaterial = exportSrtpKeyMaterial(this.masterSecret, this.clientRandom, this.serverRandom);

    const inboundContext = new SrtpContext(
      this.srtpKeyMaterial.clientWriteMasterKey,
      this.srtpKeyMaterial.clientWriteMasterSalt
    );
    const outboundContext = new SrtpContext(
      this.srtpKeyMaterial.serverWriteMasterKey,
      this.srtpKeyMaterial.serverWriteMasterSalt
    );

    this.inboundSession = new SrtpSession(inboundContext, false);
    this.outboundSession = new SrtpSession(outboundContext, true);

    this.state = 'CONNECTED';

    const connectedEvent: DtlsConnectedEvent = {
      keyMaterial: this.srtpKeyMaterial,
      inboundSession: this.inboundSession,
      outboundSession: this.outboundSession,
      profile: this.selectedProfile
    };

    this.emit('connected', connectedEvent);
  }

  private dispatch(record: Buffer): void {
    if (this.transportSender) {
      try {
        this.transportSender(record);
      } catch (err: any) {
        this.emit('error', err);
      }
    }
  }

  public close(): void {
    this.state = 'CLOSED';
    this.transportSender = null;
    this.ecdh = null;
    this.cachedFlight4 = null;
    this.emit('close');
    this.removeAllListeners();
  }
}