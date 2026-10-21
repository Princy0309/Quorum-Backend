import { EventEmitter } from 'events';
import {
  IceCandidate,
  CandidatePair,
  IceChecklist,
  formCandidatePairs,
} from './iceCandidate.js';

export type IceTransportState =
  | 'new'
  | 'checking'
  | 'connected'
  | 'completed'
  | 'failed'
  | 'disconnected'
  | 'closed';

export type IceRole = 'controlling' | 'controlled';

export interface IceTransportOptions {
  role?: IceRole;
}

export class IceTransport extends EventEmitter {
  public readonly role: IceRole;
  private state: IceTransportState = 'new';
  private localCandidates: IceCandidate[] = [];
  private remoteCandidates: IceCandidate[] = [];
  private checklist: IceChecklist | null = null;
  private selectedPair: CandidatePair | null = null;

  constructor(options: IceTransportOptions = {}) {
    super();
    this.role = options.role || 'controlling';
  }

  public getState(): IceTransportState {
    return this.state;
  }

  public getSelectedPair(): CandidatePair | null {
    return this.selectedPair;
  }

  public getLocalCandidates(): ReadonlyArray<IceCandidate> {
    return this.localCandidates;
  }

  public getRemoteCandidates(): ReadonlyArray<IceCandidate> {
    return this.remoteCandidates;
  }

  public addLocalCandidate(candidate: IceCandidate): void {
    if (this.state === 'closed') return;
    this.localCandidates.push(candidate);
    this.emit('localcandidate', candidate);
    this.updatePairs();
  }

  public addRemoteCandidate(candidate: IceCandidate): void {
    if (this.state === 'closed') return;
    this.remoteCandidates.push(candidate);
    this.emit('remotecandidate', candidate);
    this.updatePairs();
  }

  private updatePairs(): void {
    if (this.localCandidates.length === 0 || this.remoteCandidates.length === 0) {
      return;
    }

    const isControlling = this.role === 'controlling';
    const pairs = formCandidatePairs(
      this.localCandidates,
      this.remoteCandidates,
      isControlling
    );

    if (pairs.length > 0) {
      this.checklist = new IceChecklist(pairs);
      if (this.state === 'new') {
        this.setState('checking');
      }
    }
  }

  public handleCheckResult(
    pairId: string,
    success: boolean,
    rttMs?: number
  ): CandidatePair | null {
    if (!this.checklist || this.state === 'closed') return null;

    const pair = this.checklist.handleCheckResponse(pairId, success, rttMs);
    if (!pair) return null;

    if (success && this.role === 'controlling') {
      const nominated = this.checklist.nominatePair(pairId);
      if (nominated) {
        this.selectedPair = pair;
        this.setState('connected');
        this.emit('selectedpairchange', pair);
      }
    }

    const allPairs = this.checklist.getPairs();
    const allCompleted = allPairs.every(
      (p) => p.state === 'succeeded' || p.state === 'failed'
    );

    if (allCompleted && this.selectedPair) {
      this.setState('completed');
    } else if (allCompleted && !this.selectedPair) {
      this.setState('failed');
    }

    return pair;
  }

  public restart(): void {
    if (this.state === 'closed') return;
    this.localCandidates = [];
    this.remoteCandidates = [];
    this.checklist = null;
    this.selectedPair = null;
    this.setState('new');
  }

  public close(): void {
    if (this.state === 'closed') return;
    this.setState('closed');
    this.localCandidates = [];
    this.remoteCandidates = [];
    this.checklist = null;
    this.selectedPair = null;
    this.removeAllListeners();
  }

  private setState(newState: IceTransportState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.emit('statechange', newState);
  }
}

export default IceTransport;
