import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStreamTrack } from 'werift';
import { roomBroker } from './roomBroker.js';

interface PeerSession {
  socketId: string;
  userId: string;
  meetingCode: string;
  pc: RTCPeerConnection;
}

export class PeerConnectionManager {
  private sessions: Map<string, PeerSession> = new Map();

  public getSession(socketId: string): PeerSession | undefined {
    return this.sessions.get(socketId);
  }

  public async createPublisherConnection(
    meetingCode: string,
    socketId: string,
    userId: string,
    onIceCandidate: (candidate: any) => void
  ): Promise<RTCPeerConnection> {
    this.closeConnection(socketId);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate);
      }
    };

    pc.ontrack = (event) => {
      const track = event.track;
      if (!track) return;

      const trackId = track.id || `${socketId}-${Date.now()}`;
      const peer = roomBroker.getPeer(meetingCode, socketId);
      if (peer) {
        peer.tracks.set(trackId, track);
      }

      const otherSessions = Array.from(this.sessions.values()).filter(
        (s) => s.meetingCode === meetingCode && s.socketId !== socketId
      );

      for (const session of otherSessions) {
        try {
          session.pc.addTrack(track);
        } catch (err) {
          console.error('Failed to forward track to peer:', err);
        }
      }
    };

    const session: PeerSession = {
      socketId,
      userId,
      meetingCode,
      pc,
    };
    this.sessions.set(socketId, session);

    return pc;
  }

  public async handleOffer(
    meetingCode: string,
    socketId: string,
    userId: string,
    offer: any,
    onIceCandidate: (candidate: any) => void
  ): Promise<any> {
    const pc = await this.createPublisherConnection(meetingCode, socketId, userId, onIceCandidate);

    await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp, offer.type));

    const existingPeers = roomBroker.getPeers(meetingCode).filter((p) => p.socketId !== socketId);
    for (const peer of existingPeers) {
      for (const track of peer.tracks.values()) {
        try {
          pc.addTrack(track);
        } catch (err) {
          console.error('Failed to add existing track to new peer:', err);
        }
      }
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    return {
      type: answer.type,
      sdp: answer.sdp,
    };
  }

  public async handleAnswer(socketId: string, answer: any): Promise<void> {
    const session = this.sessions.get(socketId);
    if (!session) return;
    await session.pc.setRemoteDescription(new RTCSessionDescription(answer.sdp, answer.type));
  }

  public async handleIceCandidate(socketId: string, candidate: any): Promise<void> {
    const session = this.sessions.get(socketId);
    if (!session || !candidate) return;
    await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  public closeConnection(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (session) {
      try {
        session.pc.close();
      } catch (err) {
        console.error('Failed to close RTCPeerConnection:', err);
      }
      this.sessions.delete(socketId);
    }
  }

  public closeRoomConnections(meetingCode: string): void {
    for (const [socketId, session] of this.sessions.entries()) {
      if (session.meetingCode === meetingCode) {
        this.closeConnection(socketId);
      }
    }
  }
}

export const peerConnectionManager = new PeerConnectionManager();
