import crypto from 'crypto';

export interface SrtpKeyMaterial {
  clientWriteMasterKey: Buffer;
  serverWriteMasterKey: Buffer;
  clientWriteMasterSalt: Buffer;
  serverWriteMasterSalt: Buffer;
}

export const pseudoRandomFunction = (
  secret: Buffer,
  label: string,
  seed: Buffer,
  outputLength: number
): Buffer => {
  const labelBuffer = Buffer.from(label, 'ascii');
  const fullSeed = Buffer.concat([labelBuffer, seed]);

  const outputBuffers: Buffer[] = [];
  let currentA = fullSeed;
  let accumulatedBytes = 0;

  while (accumulatedBytes < outputLength) {
    currentA = crypto.createHmac('sha256', secret).update(currentA).digest();
    const hmacIteration = crypto
      .createHmac('sha256', secret)
      .update(Buffer.concat([currentA, fullSeed]))
      .digest();
    outputBuffers.push(hmacIteration);
    accumulatedBytes += hmacIteration.length;
  }

  return Buffer.concat(outputBuffers).subarray(0, outputLength);
};

export const computeMasterSecret = (
  preMasterSecret: Buffer,
  clientRandom: Buffer,
  serverRandom: Buffer
): Buffer => {
  const seed = Buffer.concat([clientRandom, serverRandom]);
  return pseudoRandomFunction(preMasterSecret, 'master secret', seed, 48);
};

export const exportSrtpKeyMaterial = (
  masterSecret: Buffer,
  clientRandom: Buffer,
  serverRandom: Buffer
): SrtpKeyMaterial => {
  const seed = Buffer.concat([clientRandom, serverRandom]);
  const keyMaterial = pseudoRandomFunction(
    masterSecret,
    'EXTRACTOR-dtls_srtp',
    seed,
    60
  );

  return {
    clientWriteMasterKey: keyMaterial.subarray(0, 16),
    serverWriteMasterKey: keyMaterial.subarray(16, 32),
    clientWriteMasterSalt: keyMaterial.subarray(32, 46),
    serverWriteMasterSalt: keyMaterial.subarray(46, 60)
  };
};

export interface DtlsRecordKeyMaterial {
  clientWriteKey: Buffer;
  serverWriteKey: Buffer;
  clientWriteIv: Buffer;
  serverWriteIv: Buffer;
}

export const deriveDtlsRecordKeys = (
  masterSecret: Buffer,
  clientRandom: Buffer,
  serverRandom: Buffer
): DtlsRecordKeyMaterial => {
  const seed = Buffer.concat([serverRandom, clientRandom]);
  const keyBlock = pseudoRandomFunction(masterSecret, 'key expansion', seed, 40);

  return {
    clientWriteKey: keyBlock.subarray(0, 16),
    serverWriteKey: keyBlock.subarray(16, 32),
    clientWriteIv: keyBlock.subarray(32, 36),
    serverWriteIv: keyBlock.subarray(36, 40)
  };
};

export const protectDtlsRecord = (
  contentType: number,
  plaintext: Buffer,
  epoch: number,
  seq: bigint,
  key: Buffer,
  fixedIv: Buffer
): Buffer => {
  const explicitNonce = Buffer.alloc(8);
  explicitNonce.writeUInt16BE(epoch, 0);
  explicitNonce.writeUInt16BE(Number((seq >> 32n) & 0xffffn), 2);
  explicitNonce.writeUInt32BE(Number(seq & 0xffffffffn), 4);

  const iv = Buffer.concat([fixedIv, explicitNonce]);

  const aad = Buffer.alloc(13);
  explicitNonce.copy(aad, 0);
  aad[8] = contentType;
  aad.writeUInt16BE(0xfefd, 9);
  aad.writeUInt16BE(plaintext.length, 11);

  const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const fragment = Buffer.concat([explicitNonce, ciphertext, authTag]);

  const header = Buffer.alloc(13);
  header[0] = contentType;
  header.writeUInt16BE(0xfefd, 1);
  header.writeUInt16BE(epoch, 3);
  header.writeUInt16BE(Number((seq >> 32n) & 0xffffn), 5);
  header.writeUInt32BE(Number(seq & 0xffffffffn), 7);
  header.writeUInt16BE(fragment.length, 11);

  return Buffer.concat([header, fragment]);
};

export const unprotectDtlsRecord = (
  record: { contentType: number; protocolVersion: number; epoch: number; sequenceNumber: bigint; fragment: Buffer },
  key: Buffer,
  fixedIv: Buffer
): Buffer => {
  if (record.fragment.length < 24) {
    throw new Error('DTLS record fragment too short for AEAD');
  }

  const explicitNonce = record.fragment.subarray(0, 8);
  const ciphertext = record.fragment.subarray(8, record.fragment.length - 16);
  const authTag = record.fragment.subarray(record.fragment.length - 16);

  const expectedNonce = Buffer.alloc(8);
  expectedNonce.writeUInt16BE(record.epoch, 0);
  expectedNonce.writeUInt16BE(Number((record.sequenceNumber >> 32n) & 0xffffn), 2);
  expectedNonce.writeUInt32BE(Number(record.sequenceNumber & 0xffffffffn), 4);

  if (!crypto.timingSafeEqual(explicitNonce, expectedNonce)) {
    throw new Error('DTLS record explicit nonce does not match header sequence');
  }

  const iv = Buffer.concat([fixedIv, explicitNonce]);

  const aad = Buffer.alloc(13);
  aad.writeUInt16BE(record.epoch, 0);
  aad.writeUInt16BE(Number((record.sequenceNumber >> 32n) & 0xffffn), 2);
  aad.writeUInt32BE(Number(record.sequenceNumber & 0xffffffffn), 4);
  aad[8] = record.contentType;
  aad.writeUInt16BE(record.protocolVersion, 9);
  aad.writeUInt16BE(ciphertext.length, 11);

  const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};