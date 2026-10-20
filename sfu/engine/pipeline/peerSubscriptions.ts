import { Subscriber } from '../subscriber.js';

export interface RemovedSubscriptionEntry {
  trackId: string;
  subscriber: Subscriber;
}

export class PeerSubscriptionRegistry {
  private peerSubscriptions: Map<string, Map<string, Subscriber>> = new Map();

  public addSubscriber(peerId: string, trackId: string, subscriber: Subscriber): Subscriber | undefined {
    let peerSubs = this.peerSubscriptions.get(peerId);
    if (!peerSubs) {
      peerSubs = new Map();
      this.peerSubscriptions.set(peerId, peerSubs);
    }
    const previous = peerSubs.get(trackId);
    peerSubs.set(trackId, subscriber);
    return previous;
  }

  public removeSubscriber(trackId: string, subscriberId: string, peerId?: string): Subscriber | undefined {
    if (peerId) {
      const peerSubs = this.peerSubscriptions.get(peerId);
      if (peerSubs) {
        const sub = peerSubs.get(trackId);
        if (sub && sub.id === subscriberId) {
          peerSubs.delete(trackId);
          if (peerSubs.size === 0) {
            this.peerSubscriptions.delete(peerId);
          }
          return sub;
        }
      }
      return undefined;
    }

    for (const [pId, subMap] of this.peerSubscriptions.entries()) {
      const sub = subMap.get(trackId);
      if (sub && sub.id === subscriberId) {
        subMap.delete(trackId);
        if (subMap.size === 0) {
          this.peerSubscriptions.delete(pId);
        }
        return sub;
      }
    }
    return undefined;
  }

  public removeTrackSubscriptions(trackId: string): Subscriber[] {
    const removed: Subscriber[] = [];
    for (const [peerId, subMap] of this.peerSubscriptions.entries()) {
      const sub = subMap.get(trackId);
      if (sub) {
        removed.push(sub);
        subMap.delete(trackId);
      }
      if (subMap.size === 0) {
        this.peerSubscriptions.delete(peerId);
      }
    }
    return removed;
  }

  public removePeer(peerId: string): RemovedSubscriptionEntry[] {
    const subs = this.peerSubscriptions.get(peerId);
    if (!subs) {
      return [];
    }
    const removed: RemovedSubscriptionEntry[] = [];
    for (const [trackId, subscriber] of subs.entries()) {
      removed.push({ trackId, subscriber });
    }
    this.peerSubscriptions.delete(peerId);
    return removed;
  }

  public getSubscriber(peerId: string, trackId: string): Subscriber | undefined {
    return this.peerSubscriptions.get(peerId)?.get(trackId);
  }

  public clear(): void {
    for (const subMap of this.peerSubscriptions.values()) {
      for (const sub of subMap.values()) {
        sub.close();
      }
      subMap.clear();
    }
    this.peerSubscriptions.clear();
  }
}
