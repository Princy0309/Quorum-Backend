import crypto from 'crypto';
import { DtlsCertificate } from './dtlsCertificate.js';
import {
  DTLS_CONTENT_TYPE,
  DTLS_HANDSHAKE_TYPE,
  wrapDtlsRecord,
  wrapHandshakeMessage
} from './dtlsRecords.js';

export interface ServerFlight4Result {
  serverRandom: Buffer;
  ecdh: crypto.ECDH;
  record: Buffer;
  nextHandshakeSeq: number;
  nextRecordSeq: bigint;
}

export const generateDtlsCookie = (clientRandom: Buffer, secret: Buffer): Buffer => {
  return crypto
    .createHmac('sha256', secret)
    .update(clientRandom)
    .digest()
    .subarray(0, 16);
};

export const buildHelloVerifyRequest = (
  cookie: Buffer,
  handshakeSeq: number,
  recordSeq: bigint
): { record: Buffer; nextHandshakeSeq: number; nextRecordSeq: bigint } => {
  const body = Buffer.alloc(3 + 1 + cookie.length);
  body.writeUInt16BE(0xfefd, 0);
  body[2] = cookie.length;
  cookie.copy(body, 3);

  const handshakeMsg = wrapHandshakeMessage(
    DTLS_HANDSHAKE_TYPE.HELLO_VERIFY_REQUEST,
    body,
    handshakeSeq
  );

  const record = wrapDtlsRecord(DTLS_CONTENT_TYPE.HANDSHAKE, handshakeMsg, 0, recordSeq);
  return {
    record,
    nextHandshakeSeq: handshakeSeq + 1,
    nextRecordSeq: recordSeq + 1n
  };
};

export const buildServerFlight4 = (
  clientRandom: Buffer,
  certificate: DtlsCertificate,
  selectedProfile: number,
  startHandshakeSeq: number,
  startRecordSeq: bigint
): ServerFlight4Result => {
  let handshakeSeq = startHandshakeSeq;

  const serverRandom = Buffer.alloc(32);
  serverRandom.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
  crypto.randomBytes(28).copy(serverRandom, 4);

  const srtpExt = Buffer.alloc(9);
  srtpExt.writeUInt16BE(14, 0);
  srtpExt.writeUInt16BE(5, 2);
  srtpExt.writeUInt16BE(2, 4);
  srtpExt.writeUInt16BE(selectedProfile, 6);
  srtpExt[8] = 0;

  const extLength = Buffer.alloc(2);
  extLength.writeUInt16BE(srtpExt.length, 0);
  const fullExtensions = Buffer.concat([extLength, srtpExt]);

  const serverHelloBody = Buffer.concat([
    Buffer.from([0xfe, 0xfd]),
    serverRandom,
    Buffer.from([0x00]),
    Buffer.from([0xc0, 0x2b]),
    Buffer.from([0x00]),
    fullExtensions
  ]);

  const serverHello = wrapHandshakeMessage(
    DTLS_HANDSHAKE_TYPE.SERVER_HELLO,
    serverHelloBody,
    handshakeSeq++
  );

  const certDer = certificate.certDer;
  const certLength3 = Buffer.from([
    (certDer.length >> 16) & 0xff,
    (certDer.length >> 8) & 0xff,
    certDer.length & 0xff
  ]);
  const certChain = Buffer.concat([certLength3, certDer]);
  const chainLength3 = Buffer.from([
    (certChain.length >> 16) & 0xff,
    (certChain.length >> 8) & 0xff,
    certChain.length & 0xff
  ]);
  const certificateBody = Buffer.concat([chainLength3, certChain]);

  const certificateMsg = wrapHandshakeMessage(
    DTLS_HANDSHAKE_TYPE.CERTIFICATE,
    certificateBody,
    handshakeSeq++
  );

  const ecdh = crypto.createECDH('prime256v1');
  const ecdhPublicKey = ecdh.generateKeys();

  const curveParams = Buffer.from([0x03, 0x00, 0x17, ecdhPublicKey.length]);
  const keyExchangeParams = Buffer.concat([curveParams, ecdhPublicKey]);

  const signedPayload = Buffer.concat([
    clientRandom,
    serverRandom,
    keyExchangeParams
  ]);

  const signer = crypto.createSign('SHA256');
  signer.update(signedPayload);
  const signatureDer = signer.sign(certificate.privateKey);

  const sigHeader = Buffer.from([0x04, 0x03, (signatureDer.length >> 8) & 0xff, signatureDer.length & 0xff]);
  const serverKeyExchangeBody = Buffer.concat([keyExchangeParams, sigHeader, signatureDer]);

  const serverKeyExchangeMsg = wrapHandshakeMessage(
    DTLS_HANDSHAKE_TYPE.SERVER_KEY_EXCHANGE,
    serverKeyExchangeBody,
    handshakeSeq++
  );

  const serverHelloDone = wrapHandshakeMessage(
    DTLS_HANDSHAKE_TYPE.SERVER_HELLO_DONE,
    Buffer.alloc(0),
    handshakeSeq++
  );

  const flightFragment = Buffer.concat([
    serverHello,
    certificateMsg,
    serverKeyExchangeMsg,
    serverHelloDone
  ]);

  const record = wrapDtlsRecord(DTLS_CONTENT_TYPE.HANDSHAKE, flightFragment, 0, startRecordSeq);

  return {
    serverRandom,
    ecdh,
    record,
    nextHandshakeSeq: handshakeSeq,
    nextRecordSeq: startRecordSeq + 1n
  };
};
