import { EventEmitter } from 'events';
import type { MediaStreamTrack, RTCRtpSender } from 'werift';
import type { SfuRoom, Peer, PublishedTrack, TrackSubscriber } from './types.js';
import logger from '../utils/logger.js';

export class RoomBroker extends EventEmitter {
  private static instance: RoomBroker;
  private rooms: Map<string, SfuRoom> = new Map();
  private constructor() {
    super();
  }
  public static getInstance(): RoomBroker {
    if (!RoomBroker.instance) {
      RoomBroker.instance = new RoomBroker();
    }
    return RoomBroker.instance;
  }

  public getOrCreateRoom(roomCode: string): SfuRoom {
    let room = this.rooms.get(roomCode);

    if(!room){
        room = {
            code: roomCode,
            peers : new Map(),
            channels : new Map()
        };
        this.rooms.set(roomCode, room);
        logger.info(`[SFU Broker] Created room: ${roomCode}`);
    }

    return room;
  }

  public addPeer(roomCode: string, peerId: string, socketId: string, name?: string): Peer{
    const room = this.getOrCreateRoom(roomCode);
    let peer = room.peers.get(peerId);

    if(!peer){
        peer = {
            id: peerId,
            name: name || '',
            socketId,
            publishedTracks: new Map(),
        }
        room.peers.set(peerId, peer);
    logger.info(`[SFU Broker] Peer ${peerId} joined SFU room ${roomCode}`);
    }else{
    peer.socketId = socketId;
     }
     return peer;
}
    
    
}

export const roomBroker = RoomBroker.getInstance();
