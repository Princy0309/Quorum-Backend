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