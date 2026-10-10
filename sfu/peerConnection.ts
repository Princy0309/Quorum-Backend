import { RTCPeerConnection, RTCRtpCodecParameters } from "werift";
import logger from "../utils/logger.js";

export const AUDIO_CODEC = new RTCRtpCodecParameters({
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
});

export const VIDEO_CODEC = new RTCRtpCodecParameters({
    mimeType: 'video/VP8',
    clockRate: 90000,
    rtcpFeedback: [
     { type: 'nack' },
     { type: 'nack', parameter: 'pli' },
     { type: 'goog-remb' },
  ],
});

export const createPeerConnection = (): RTCPeerConnection => {
  const pc = new RTCPeerConnection({
    codecs: {
      audio: [AUDIO_CODEC],
      video: [VIDEO_CODEC],
    },
    iceServers: [
      {
        urls: 'stun:stun.l.google.com:19302',
      },
    ],
  });

  pc.connectionStateChange.subscribe((state) => {
    logger.info(`[WebRTC] PeerConnection state: ${state}`);
  });

  pc.iceConnectionStateChange.subscribe((state) => {
    logger.info(`[WebRTC] ICE connection state: ${state}`);
  });

  return pc;
};

class PeerConnectionManager {
  private muteStates = new Map<string, Map<string, boolean>>();

  setPeerMuteStatus(roomCode: string, userId: string, isMuted: boolean): void {
    let room = this.muteStates.get(roomCode);
    if (!room) {
      room = new Map();
      this.muteStates.set(roomCode, room);
    }
    room.set(userId, isMuted);
  }

  getPeerMuteStatus(roomCode: string, userId: string): boolean {
    return this.muteStates.get(roomCode)?.get(userId) ?? false;
  }

  closeConnection(roomCode: string, peerId: string): void {
    
  }

  closeRoomConnections(roomCode: string): void {
    this.muteStates.delete(roomCode);
  }
}

export const peerConnectionManager = new PeerConnectionManager();
