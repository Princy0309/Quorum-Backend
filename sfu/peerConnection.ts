export interface PeerConnectionOptions {
  iceServers?: RTCIceServer[];
}

export class PeerConnectionManager {
  private peerConnections: Map<string, any> = new Map();

  public closeConnection(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (pc && typeof pc.close === 'function') {
      pc.close();
    }
    this.peerConnections.delete(peerId);
  }

  public closeAll(): void {
    for (const [peerId, pc] of this.peerConnections.entries()) {
      if (pc && typeof pc.close === 'function') {
        pc.close();
      }
    }
    this.peerConnections.clear();
  }
}

export const peerConnectionManager = new PeerConnectionManager();
