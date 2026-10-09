import { SfuPeer, SfuRoom } from './types.js';

class RoomBroker {
  private rooms: Map<string, SfuRoom> = new Map();

  public getOrCreateRoom(meetingCode: string): SfuRoom {
    let room = this.rooms.get(meetingCode);
    if (!room) {
      room = {
        meetingCode,
        peers: new Map(),
      };
      this.rooms.set(meetingCode, room);
    }
    return room;
  }

  public addPeer(meetingCode: string, peer: SfuPeer): void {
    const room = this.getOrCreateRoom(meetingCode);
    room.peers.set(peer.socketId, peer);
  }

  public getPeer(meetingCode: string, socketId: string): SfuPeer | undefined {
    const room = this.rooms.get(meetingCode);
    return room?.peers.get(socketId);
  }

  public removePeer(meetingCode: string, socketId: string): void {
    const room = this.rooms.get(meetingCode);
    if (room) {
      room.peers.delete(socketId);
      if (room.peers.size === 0) {
        this.rooms.delete(meetingCode);
      }
    }
  }

  public removePeersByUser(meetingCode: string, userId: string): void {
    const room = this.rooms.get(meetingCode);
    if (room) {
      for (const [socketId, peer] of room.peers.entries()) {
        if (peer.userId === userId) {
          room.peers.delete(socketId);
        }
      }
      if (room.peers.size === 0) {
        this.rooms.delete(meetingCode);
      }
    }
  }

  public getPeers(meetingCode: string): SfuPeer[] {
    const room = this.rooms.get(meetingCode);
    if (!room) return [];
    return Array.from(room.peers.values());
  }

  public closeRoom(meetingCode: string): void {
    this.rooms.delete(meetingCode);
  }
}

export const roomBroker = new RoomBroker();
