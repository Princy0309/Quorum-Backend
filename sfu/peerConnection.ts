import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStreamTrack } from 'werift';
import { roomBroker } from './roomBroker.js';

export interface PeerSession {
  socketId: string;
  userId: string;
  meetingCode: string;
  pc: RTCPeerConnection;
  isMuted: boolean;
  tracks: Map<string, MediaStreamTrack>;
}

export class PeerConnectionManager {
  private sessions: Map<string, PeerSession> = new Map();

  private getSessionKey(meetingCode: string, socketId: string): string {
    return `${meetingCode.trim()}:${socketId.trim()}`;
  }

  public getSession(meetingCode: string, socketId: string): PeerSession | undefined {
    return this.sessions.get(this.getSessionKey(meetingCode, socketId));
  }

  public async createPublisherConnection(
    meetingCode: string,
    socketId: string,
    userId: string,
    onIceCandidate: (candidate: any) => void,
    onRenegotiationOffer: (targetSocketId: string, offer: any) => void
  ): Promise<RTCPeerConnection> {
    this.closeConnection(meetingCode, socketId);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    const session: PeerSession = {
      socketId,
      userId,
      meetingCode,
      pc,
      isMuted: false,
      tracks: new Map(),
    };
    this.sessions.set(this.getSessionKey(meetingCode, socketId), session);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate);
      }
    };

    pc.ontrack = async (event) => {
      const track = event.track;
      if (!track) return;

      const trackId = track.id || `${socketId}-${Date.now()}`;
      session.tracks.set(trackId, track);

      const peer = roomBroker.getPeer(meetingCode, socketId);
      if (peer) {
        peer.tracks.set(trackId, track);
      }

      const otherSessions = Array.from(this.sessions.values()).filter(
        (s) => s.meetingCode === meetingCode && s.socketId !== socketId
      );

      for (const otherSession of otherSessions) {
        try {
          otherSession.pc.addTrack(track);
          const renegotiatedOffer = await otherSession.pc.createOffer();
          await otherSession.pc.setLocalDescription(renegotiatedOffer);
          onRenegotiationOffer(otherSession.socketId, {
            type: renegotiatedOffer.type,
            sdp: renegotiatedOffer.sdp,
          });
        } catch (err) {
          console.error('Failed to forward track and renegotiate with peer:', err);
        }
      }
    };

    return pc;
  }

  public async handleOffer(
    meetingCode: string,
    socketId: string,
    userId: string,
    offer: any,
    onIceCandidate: (candidate: any) => void,
    onRenegotiationOffer: (targetSocketId: string, offer: any) => void
  ): Promise<any> {
    const pc = await this.createPublisherConnection(
      meetingCode,
      socketId,
      userId,
      onIceCandidate,
      onRenegotiationOffer
    );

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

  public async handleAnswer(meetingCode: string, socketId: string, answer: any): Promise<void> {
    const session = this.getSession(meetingCode, socketId);
    if (!session) {
      throw new Error('Peer connection session not found');
    }
    await session.pc.setRemoteDescription(new RTCSessionDescription(answer.sdp, answer.type));
  }

  public async handleIceCandidate(meetingCode: string, socketId: string, candidate: any): Promise<void> {
    const session = this.getSession(meetingCode, socketId);
    if (!session || !candidate) {
      throw new Error('Peer connection session not found');
    }
    await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  public setPeerMuteStatus(meetingCode: string, userId: string, isMuted: boolean): void {
    const matchingSessions = Array.from(this.sessions.values()).filter(
      (s) => s.meetingCode === meetingCode && s.userId === userId
    );

    for (const session of matchingSessions) {
      session.isMuted = isMuted;
    }
  }

  public closeConnection(meetingCode: string, socketId: string): void {
    const key = this.getSessionKey(meetingCode, socketId);
    const session = this.sessions.get(key);
    if (session) {
      try {
        session.pc.close();
      } catch (err) {
        console.error('Failed to close RTCPeerConnection:', err);
      }
      this.sessions.delete(key);
    }
  }

  public closeAllSocketConnections(socketId: string): void {
    for (const [key, session] of this.sessions.entries()) {
      if (session.socketId === socketId) {
        try {
          session.pc.close();
        } catch (err) {
          console.error('Failed to close RTCPeerConnection:', err);
        }
        this.sessions.delete(key);
      }
    }
  }

  public closeRoomConnections(meetingCode: string): void {
    for (const [key, session] of this.sessions.entries()) {
      if (session.meetingCode === meetingCode) {
        try {
          session.pc.close();
        } catch (err) {
          console.error('Failed to close RTCPeerConnection:', err);
        }
        this.sessions.delete(key);
      }
    }
  }
}

export const peerConnectionManager = new PeerConnectionManager();
