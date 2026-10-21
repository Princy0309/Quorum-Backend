export enum CandidateType {
  HOST = 'host',
  SRFLX = 'srflx',
  PRFLX = 'prflx',
  RELAY = 'relay',
}

export enum TransportProtocol {
  UDP = 'udp',
  TCP = 'tcp',
}

export enum CandidateComponent {
  RTP = 1,
  RTCP = 2,
}

export type CandidatePairState = 'waiting' | 'in-progress' | 'succeeded' | 'failed' | 'frozen';

export interface IceCandidateInit {
  foundation: string;
  component: CandidateComponent;
  protocol: TransportProtocol;
  priority?: number;
  ip: string;
  port: number;
  type: CandidateType;
  relatedAddress?: string;
  relatedPort?: number;
}

export interface CandidatePair {
  id: string;
  local: IceCandidate;
  remote: IceCandidate;
  priority: bigint;
  state: CandidatePairState;
  nominated: boolean;
  lastCheckSent?: number;
  rtt?: number;
}

const TYPE_PREFERENCES: Record<CandidateType, number> = {
  [CandidateType.HOST]: 126,
  [CandidateType.PRFLX]: 110,
  [CandidateType.SRFLX]: 100,
  [CandidateType.RELAY]: 0,
};

export class IceCandidate {
  public readonly foundation: string;
  public readonly component: CandidateComponent;
  public readonly protocol: TransportProtocol;
  public readonly priority: number;
  public readonly ip: string;
  public readonly port: number;
  public readonly type: CandidateType;
  public readonly relatedAddress?: string;
  public readonly relatedPort?: number;

  constructor(init: IceCandidateInit) {
    this.foundation = init.foundation;
    this.component = init.component;
    this.protocol = init.protocol;
    this.ip = init.ip;
    this.port = init.port;
    this.type = init.type;
    this.relatedAddress = init.relatedAddress;
    this.relatedPort = init.relatedPort;

    this.priority =
      init.priority !== undefined
        ? init.priority
        : IceCandidate.computeCandidatePriority(init.type, init.component);
  }

  public static computeCandidatePriority(
    type: CandidateType,
    component: CandidateComponent,
    localPreference = 65535
  ): number {
    const typePref = TYPE_PREFERENCES[type] ?? 0;
    const clampedLocalPref = Math.min(65535, Math.max(0, localPreference));
    const compId = Math.min(256, Math.max(1, component));

    return ((typePref << 24) | (clampedLocalPref << 8) | (256 - compId)) >>> 0;
  }

  public toSdp(): string {
    let sdp = `candidate:${this.foundation} ${this.component} ${this.protocol.toUpperCase()} ${this.priority} ${this.ip} ${this.port} typ ${this.type}`;
    if (this.relatedAddress && this.relatedPort) {
      sdp += ` raddr ${this.relatedAddress} rport ${this.relatedPort}`;
    }
    return sdp;
  }
}

export const computePairPriority = (
  controllingPriority: number,
  controlledPriority: number
): bigint => {
  const g = BigInt(controllingPriority >>> 0);
  const d = BigInt(controlledPriority >>> 0);

  const min = g < d ? g : d;
  const max = g > d ? g : d;
  const tieBreaker = g > d ? 1n : 0n;

  const twoPow32 = 4294967296n;
  return twoPow32 * min + 2n * max + tieBreaker;
};

export const formCandidatePairs = (
  localCandidates: IceCandidate[],
  remoteCandidates: IceCandidate[],
  isControlling: boolean
): CandidatePair[] => {
  const pairs: CandidatePair[] = [];

  for (const local of localCandidates) {
    for (const remote of remoteCandidates) {
      if (local.component !== remote.component) continue;
      if (local.protocol !== remote.protocol) continue;

      const priority = isControlling
        ? computePairPriority(local.priority, remote.priority)
        : computePairPriority(remote.priority, local.priority);

      const id = `${local.component}:${local.protocol}:${local.ip}:${local.port}->${remote.ip}:${remote.port}`;

      pairs.push({
        id,
        local,
        remote,
        priority,
        state: 'waiting',
        nominated: false,
      });
    }
  }

  return pairs.sort((a, b) => {
    if (b.priority > a.priority) return 1;
    if (b.priority < a.priority) return -1;
    return 0;
  });
};

export class IceChecklist {
  private pairs: CandidatePair[];
  private activeNominatedPair: CandidatePair | null = null;

  constructor(pairs: CandidatePair[]) {
    this.pairs = [...pairs];
  }

  public getPairs(): CandidatePair[] {
    return this.pairs;
  }

  public getActivePair(): CandidatePair | null {
    return this.activeNominatedPair;
  }

  public getNextCheckPair(): CandidatePair | null {
    const nextWaiting = this.pairs.find((p) => p.state === 'waiting');
    if (!nextWaiting) return null;

    nextWaiting.state = 'in-progress';
    nextWaiting.lastCheckSent = Date.now();
    return nextWaiting;
  }

  public handleCheckResponse(pairId: string, success: boolean, rttMs?: number): CandidatePair | null {
    const pair = this.pairs.find((p) => p.id === pairId);
    if (!pair) return null;

    if (success) {
      pair.state = 'succeeded';
      if (rttMs !== undefined) {
        pair.rtt = rttMs;
      }
    } else {
      pair.state = 'failed';
    }

    return pair;
  }

  public nominatePair(pairId: string): boolean {
    const pair = this.pairs.find((p) => p.id === pairId);
    if (!pair || pair.state !== 'succeeded') {
      return false;
    }

    for (const p of this.pairs) {
      p.nominated = false;
    }

    pair.nominated = true;
    this.activeNominatedPair = pair;
    return true;
  }

  public isConnectionEstablished(): boolean {
    return this.activeNominatedPair !== null && this.activeNominatedPair.state === 'succeeded';
  }
}
