export interface SfuConfiguration {
  portRange: [number, number];
  stunUrls: string[];
  announcedIp: string;
  maxBitrate: number;
  workerCount: number;
}

const readPositiveInteger = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};

const minPort = readPositiveInteger('SFU_MIN_PORT', 40000);
const maxPort = readPositiveInteger('SFU_MAX_PORT', 40100);

if (minPort < 1024 || maxPort > 65535 || minPort > maxPort) {
  throw new Error('Invalid SFU port range');
}

const announcedIp =
  process.env.ANNOUNCED_IP?.trim() ||
  (process.env.NODE_ENV === 'production' ? '' : '127.0.0.1');

if (!announcedIp) {
  throw new Error('ANNOUNCED_IP must be configured');
}

export const sfuConfig: SfuConfiguration = {
  portRange: [minPort, maxPort],
  stunUrls: [
    process.env.STUN_SERVER?.trim() || 'stun:stun.l.google.com:19302',
  ],
  announcedIp,
  maxBitrate: readPositiveInteger('SFU_MAX_BITRATE', 1500000),
  workerCount: readPositiveInteger('SFU_WORKERS', 2),
};

export default sfuConfig;
