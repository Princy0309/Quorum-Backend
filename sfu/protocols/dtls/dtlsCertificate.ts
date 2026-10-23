import crypto, { KeyObject } from 'crypto';

export interface DtlsCertificate {
  certDer: Buffer;
  keyPem: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  fingerprint: string;
}

const encodeDerLength = (length: number): Buffer => {
  if (length < 128) {
    return Buffer.from([length]);
  }
  if (length < 256) {
    return Buffer.from([0x81, length]);
  }
  return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
};

const wrapDer = (tag: number, content: Buffer): Buffer => {
  return Buffer.concat([Buffer.from([tag]), encodeDerLength(content.length), content]);
};

const formatUtcTime = (date: Date): Buffer => {
  const formatted = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
  return wrapDer(0x17, Buffer.from(formatted, 'ascii'));
};

export const computeCertificateFingerprint = (certDer: Buffer): string => {
  const hash = crypto.createHash('sha256').update(certDer).digest();
  const hexParts: string[] = [];
  for (let i = 0; i < hash.length; i++) {
    hexParts.push(hash[i].toString(16).padStart(2, '0').toUpperCase());
  }
  return hexParts.join(':');
};

export const generateDtlsCertificate = (commonName: string = 'Quorum-SFU'): DtlsCertificate => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
  });

  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const version = Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02]);
  const serialBytes = crypto.randomBytes(8);
  serialBytes[0] &= 0x7f;
  const serial = wrapDer(0x02, serialBytes);
  const signatureAlgorithm = Buffer.from([
    0x30, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02
  ]);

  const cnValue = wrapDer(0x0c, Buffer.from(commonName, 'utf8'));
  const cnOid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
  const cnSequence = wrapDer(0x30, Buffer.concat([cnOid, cnValue]));
  const cnSet = wrapDer(0x31, cnSequence);
  const distinguishedName = wrapDer(0x30, cnSet);

  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const validity = wrapDer(0x30, Buffer.concat([formatUtcTime(notBefore), formatUtcTime(notAfter)]));

  const tbsCertificate = wrapDer(0x30, Buffer.concat([
    version,
    serial,
    signatureAlgorithm,
    distinguishedName,
    validity,
    distinguishedName,
    spki
  ]));

  const rawSignature = crypto.sign('sha256', tbsCertificate, privateKey);
  const bitStringSignature = Buffer.concat([
    Buffer.from([0x03]),
    encodeDerLength(rawSignature.length + 1),
    Buffer.from([0x00]),
    rawSignature
  ]);

  const certDer = wrapDer(0x30, Buffer.concat([
    tbsCertificate,
    signatureAlgorithm,
    bitStringSignature
  ]));

  const fingerprint = computeCertificateFingerprint(certDer);

  return {
    certDer,
    keyPem,
    privateKey,
    publicKey,
    fingerprint
  };
};