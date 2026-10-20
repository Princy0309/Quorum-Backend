import crypto from 'crypto';
import { EventEmitter } from 'events';
import { DtlsCertificate } from './dtlsCertificate.js';
import {
  computeMasterSecret,
  deriveDtlsRecordKeys,
  DtlsRecordKeyMaterial,
  exportSrtpKeyMaterial,
  pseudoRandomFunction,
  SrtpKeyMaterial,
  unprotectDtlsRecord
} from './dtlsKeys.js';
import { SrtpContext } from '../srtp/srtpContext.js';
import { SrtpSession } from '../srtp/srtpPacket.js';
import {
  DTLS_CONTENT_TYPE,
  DTLS_HANDSHAKE_TYPE,
  SRTP_PROFILE,
  DtlsRecord,
  DtlsHandshakeMessage,
  HandshakeReassembler,
  parseDtlsRecords,
  parseHandshakeMessages,
  wrapHandshakeMessage
} from './dtlsRecords.js';
import {
  generateDtlsCookie,
  buildHelloVerifyRequest,
  buildServerFlight4,
  buildServerFlight6
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
  private state: 'INITIAL' | 'VERIFY_REQUESTED' | 'WAIT_CLIENT_KEY_EXCHANGE' | 'WAIT_FINISHED' | 'CONNECTED' | 'CLOSED' = 'INITIAL';

  private clientRandom: Buffer | null = null;
  private serverRandom: Buffer | null = null;
  private ecdh: crypto.ECDH | null = null;
  private serverHandshakeSeq: number = 0;
  private serverRecordSeq: bigint = 0n;
  private selectedProfile: number = SRTP_PROFILE.SRTP_AES128_CM_HMAC_SHA1_80;

  private masterSecret: Buffer | null = null;
  private recordKeys: DtlsRecordKeyMaterial | null = null;
  private srtpKeyMaterial: SrtpKeyMaterial | null = null;
  private inboundSession: SrtpSession | null = null;
  private outboundSession: SrtpSession | null = null;
  private cachedFlight4: Buffer | null = null;
  private cachedFlight6: Buffer[] | null = null;
  private handshakeTranscript: Buffer[] = [];
  private reassembler: HandshakeReassembler = new HandshakeReassembler();
  private receivedChangeCipherSpec: boolean = false;
  private expectedClientHandshakeSeq: number = 0;
  private retransmitTimer: NodeJS.Timeout | null = null;
  private retransmitAttempts: number = 0;
  private readonly maxRetransmitAttempts: number = 5;
  private retransmitTimeoutMs: number = 1000;
  private flight6RetransmitTimer: NodeJS.Timeout | null = null;
  private flight6RetransmitAttempts: number = 0;
  private readonly maxFlight6RetransmitAttempts: number = 3;
  private flight6TimeoutMs: number = 1000;

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

  private startRetransmitTimer(): void {
    this.clearRetransmitTimer();
    this.retransmitAttempts = 0;
    this.retransmitTimeoutMs = 1000;

    const schedule = () => {
      this.retransmitTimer = setTimeout(() => {
        if (this.state === 'CLOSED' || this.state === 'CONNECTED') {
          return;
        }
        this.retransmitAttempts++;
        if (this.retransmitAttempts > this.maxRetransmitAttempts) {
          this.emit('error', new Error('DTLS handshake retransmission limit exceeded'));
          this.close();
          return;
        }
        if (this.state === 'WAIT_CLIENT_KEY_EXCHANGE' && this.cachedFlight4) {
          this.dispatch(this.cachedFlight4);
        }
        this.retransmitTimeoutMs = Math.min(this.retransmitTimeoutMs * 2, 8000);
        schedule();
      }, this.retransmitTimeoutMs);
    };

    schedule();
  }

  private clearRetransmitTimer(): void {
    if (this.retransmitTimer) {
      clearTimeout(this.retransmitTimer);
      this.retransmitTimer = null;
    }
  }

  private startFlight6RetransmitTimer(): void {
    this.clearFlight6RetransmitTimer();
    this.flight6RetransmitAttempts = 0;
    this.flight6TimeoutMs = 1000;

    const schedule = () => {
      this.flight6RetransmitTimer = setTimeout(() => {
        if (this.state !== 'CONNECTED' || !this.cachedFlight6) {
          return;
        }
        this.flight6RetransmitAttempts++;
        if (this.flight6RetransmitAttempts > this.maxFlight6RetransmitAttempts) {
          this.clearFlight6RetransmitTimer();
          return;
        }
        for (const record of this.cachedFlight6) {
          this.dispatch(record);
        }
        this.flight6TimeoutMs = Math.min(this.flight6TimeoutMs * 2, 4000);
        schedule();
      }, this.flight6TimeoutMs);
    };

    schedule();
  }

  private clearFlight6RetransmitTimer(): void {
    if (this.flight6RetransmitTimer) {
      clearTimeout(this.flight6RetransmitTimer);
      this.flight6RetransmitTimer = null;
    }
  }

  public handleIncomingDatagram(datagram: Buffer): void {
    if (this.state === 'CLOSED' || datagram.length < 13) {
      return;
    }

    if (this.state === 'CONNECTED') {
      this.clearFlight6RetransmitTimer();
    }

    const records = parseDtlsRecords(datagram);
    for (const record of records) {
      if (record.contentType === DTLS_CONTENT_TYPE.HANDSHAKE) {
        if (record.epoch === 0) {
          this.processHandshakeRecord(record.fragment, 0);
        } else if (record.epoch === 1) {
          if (!this.recordKeys || (this.state !== 'WAIT_FINISHED' && this.state !== 'CONNECTED')) {
            continue;
          }
          try {
            const decrypted = unprotectDtlsRecord(record, this.recordKeys.clientWriteKey, this.recordKeys.clientWriteIv);
            this.processHandshakeRecord(decrypted, 1);
          } catch (err: any) {
            this.emit('error', new Error('DTLS record decryption failed: ' + err.message));
          }
        }
      } else if (record.contentType === DTLS_CONTENT_TYPE.CHANGE_CIPHER_SPEC) {
        if (record.epoch !== 0 || record.fragment.length !== 1 || record.fragment[0] !== 0x01 || this.state !== 'WAIT_FINISHED') {
          this.emit('error', new Error('Invalid ChangeCipherSpec record, epoch, or state'));
          return;
        }
        this.receivedChangeCipherSpec = true;
      } else if (record.contentType === DTLS_CONTENT_TYPE.ALERT) {
        this.emit('alert', record.fragment);
      }
    }
  }

  private processHandshakeRecord(fragment: Buffer, epoch: number): void {
    const messages = parseHandshakeMessages(fragment, this.reassembler);
    for (const msg of messages) {
      if (msg.msgType === DTLS_HANDSHAKE_TYPE.CLIENT_HELLO) {
        if (epoch !== 0) {
          this.emit('error', new Error('ClientHello received in invalid epoch'));
          return;
        }
        if (this.state === 'WAIT_CLIENT_KEY_EXCHANGE' && this.cachedFlight4 && (msg.messageSeq === 0 || msg.messageSeq === 1)) {
          this.dispatch(this.cachedFlight4);
          this.startRetransmitTimer();
          return;
        }
        if (this.state !== 'INITIAL' && this.state !== 'VERIFY_REQUESTED') {
          this.emit('error', new Error('Unexpected ClientHello in state ' + this.state));
          return;
        }
        if (this.state === 'INITIAL' && msg.messageSeq !== 0) {
          this.emit('error', new Error('Invalid initial ClientHello messageSeq: ' + msg.messageSeq));
          return;
        }
        if (this.state === 'VERIFY_REQUESTED' && msg.messageSeq !== 1 && msg.messageSeq !== 0) {
          this.emit('error', new Error('Invalid ClientHello retry messageSeq: ' + msg.messageSeq));
          return;
        }
        this.onClientHello(msg);
      } else if (msg.msgType === DTLS_HANDSHAKE_TYPE.CLIENT_KEY_EXCHANGE) {
        if (epoch !== 0) {
          this.emit('error', new Error('ClientKeyExchange received in invalid epoch'));
          return;
        }
        if (this.state === 'WAIT_FINISHED' && msg.messageSeq === (this.expectedClientHandshakeSeq - 1)) {
          return;
        }
        if (this.state !== 'WAIT_CLIENT_KEY_EXCHANGE') {
          this.emit('error', new Error('Unexpected ClientKeyExchange in state ' + this.state));
          return;
        }
        if (msg.messageSeq !== this.expectedClientHandshakeSeq) {
          this.emit('error', new Error('Invalid ClientKeyExchange messageSeq: ' + msg.messageSeq + ', expected ' + this.expectedClientHandshakeSeq));
          return;
        }
        this.onClientKeyExchange(msg);
      } else if (msg.msgType === DTLS_HANDSHAKE_TYPE.FINISHED) {
        if (epoch !== 1) {
          this.emit('error', new Error('Finished received in invalid epoch'));
          return;
        }
        if (this.state === 'CONNECTED' && msg.messageSeq === (this.expectedClientHandshakeSeq - 1) && this.cachedFlight6) {
          for (const rec of this.cachedFlight6) {
            this.dispatch(rec);
          }
          return;
        }
        if (this.state !== 'WAIT_FINISHED') {
          this.emit('error', new Error('Unexpected Finished in state ' + this.state));
          return;
        }
        if (!this.receivedChangeCipherSpec) {
          this.emit('error', new Error('Finished received before ChangeCipherSpec'));
          return;
        }
        if (msg.messageSeq !== this.expectedClientHandshakeSeq) {
          this.emit('error', new Error('Invalid Finished messageSeq: ' + msg.messageSeq + ', expected ' + this.expectedClientHandshakeSeq));
          return;
        }
        this.onClientFinished(msg, epoch);
      }
    }
  }

  private onClientHello(msg: DtlsHandshakeMessage): void {
    const body = msg.body;
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
    const rawClientHelloMsg = wrapHandshakeMessage(msg.msgType, msg.body, msg.messageSeq);

    if (this.requireCookie && (cookieLength === 0 || !crypto.timingSafeEqual(cookie, expectedCookie))) {
      const verify = buildHelloVerifyRequest(expectedCookie, this.serverHandshakeSeq, this.serverRecordSeq);
      this.serverHandshakeSeq = verify.nextHandshakeSeq;
      this.serverRecordSeq = verify.nextRecordSeq;
      this.handshakeTranscript = [rawClientHelloMsg, verify.handshakeMessage];
      this.expectedClientHandshakeSeq = 1;
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

    let profileSelected = false;

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
            if (profile === SRTP_PROFILE.SRTP_AES128_CM_HMAC_SHA1_80) {
              this.selectedProfile = profile;
              profileSelected = true;
              break;
            }
            pOffset += 2;
          }
        }
        offset += extLen;
      }
    }

    if (!profileSelected) {
      this.emit('error', new Error('No supported DTLS-SRTP profile offered by client'));
      this.close();
      return;
    }

    if (this.handshakeTranscript.length > 0) {
      this.handshakeTranscript.push(rawClientHelloMsg);
    } else {
      this.handshakeTranscript = [rawClientHelloMsg];
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
    this.handshakeTranscript.push(flight4.handshakeMessages);

    this.dispatch(flight4.record);
    this.expectedClientHandshakeSeq = msg.messageSeq + 1;
    this.state = 'WAIT_CLIENT_KEY_EXCHANGE';
    this.startRetransmitTimer();
  }

  private onClientKeyExchange(msg: DtlsHandshakeMessage): void {
    const body = msg.body;
    if (body.length < 2 || !this.ecdh || !this.clientRandom || !this.serverRandom) {
      return;
    }

    const keyLength = body[0];
    if (keyLength + 1 > body.length) {
      return;
    }

    const clientPublicKey = body.subarray(1, 1 + keyLength);

    try {
      const preMasterSecret = this.ecdh.computeSecret(clientPublicKey);
      this.masterSecret = computeMasterSecret(preMasterSecret, this.clientRandom, this.serverRandom);
      this.recordKeys = deriveDtlsRecordKeys(this.masterSecret, this.clientRandom, this.serverRandom);
    } catch (err: any) {
      this.emit('error', err);
      return;
    }

    const rawClientKeyExchangeMsg = wrapHandshakeMessage(msg.msgType, msg.body, msg.messageSeq);
    this.handshakeTranscript.push(rawClientKeyExchangeMsg);

    this.clearRetransmitTimer();
    this.expectedClientHandshakeSeq = msg.messageSeq + 1;
    this.state = 'WAIT_FINISHED';
  }

  private onClientFinished(msg: DtlsHandshakeMessage, epoch: number): void {
    if (
      this.state !== 'WAIT_FINISHED' ||
      !this.receivedChangeCipherSpec ||
      epoch !== 1 ||
      !this.masterSecret ||
      !this.recordKeys ||
      !this.clientRandom ||
      !this.serverRandom
    ) {
      return;
    }

    const clientVerifyData = msg.body.subarray(0, 12);
    if (clientVerifyData.length !== 12) {
      return;
    }

    const transcriptBuffer = Buffer.concat(this.handshakeTranscript);
    const transcriptHash = crypto.createHash('sha256').update(transcriptBuffer).digest();
    const expectedVerifyData = pseudoRandomFunction(this.masterSecret, 'client finished', transcriptHash, 12);

    if (!crypto.timingSafeEqual(clientVerifyData, expectedVerifyData)) {
      this.emit('error', new Error('DTLS client Finished verify_data mismatch'));
      return;
    }

    const rawFinishedMsg = wrapHandshakeMessage(msg.msgType, msg.body, msg.messageSeq);
    this.handshakeTranscript.push(rawFinishedMsg);

    const flight6 = buildServerFlight6(
      this.masterSecret,
      this.recordKeys,
      Buffer.concat(this.handshakeTranscript),
      this.serverHandshakeSeq,
      this.serverRecordSeq
    );

    this.serverHandshakeSeq = flight6.nextHandshakeSeq;
    this.serverRecordSeq = flight6.nextRecordSeq;

    this.dispatch(flight6.changeCipherSpecRecord);
    this.dispatch(flight6.finishedRecord);

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

    this.clearRetransmitTimer();
    this.cachedFlight6 = [flight6.changeCipherSpecRecord, flight6.finishedRecord];
    this.expectedClientHandshakeSeq = msg.messageSeq + 1;
    this.state = 'CONNECTED';
    this.startFlight6RetransmitTimer();

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
    this.clearRetransmitTimer();
    this.clearFlight6RetransmitTimer();
    this.state = 'CLOSED';
    this.transportSender = null;
    this.ecdh = null;
    this.cachedFlight4 = null;
    this.cachedFlight6 = null;
    this.recordKeys = null;
    this.masterSecret = null;
    this.handshakeTranscript = [];
    this.reassembler.clear();
    this.emit('close');
    this.removeAllListeners();
  }
}