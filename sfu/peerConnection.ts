import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStreamTrack } from 'werift';
import { roomBroker } from './roomBroker.js';

export interface PeerSession {
  socketId: string;
  userId: string;
  meetingCode: string;
  pc: RTCPeerConnection;
  isMuted: boolean;
  tracks: Map<string, MediaStreamTrack>;
  isNegotiating: boolean;
  pendingRenegotiation: boolean;
  pendingIceCandidates: any[];
  onRenegotiationOffer?: (targetSocketId: string, offer: any) => void;
}

export class PeerConnectionManager {
  private sessions: Map<string, PeerSession> = new Map();
  private earlyIceCandidates: Map<string, any[]> = new Map();

  private getSessionKey(meetingCode: string, socketId: string): string {
    return `${meetingCode.trim()}:${socketId.trim()}`;
  }

  public getSession(meetingCode: string, socketId: string): PeerSession | undefined {
    return this.sessions.get(this.getSessionKey(meetingCode, socketId));
  }

  private async flushPendingIceCandidates(session: PeerSession): Promise<void> {
    while (session.pendingIceCandidates.length > 0) {
      const candidate = session.pendingIceCandidates.shift();
      try {
        await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Failed to add queued ICE candidate:', err);
      }
    }
  }

  public async triggerRenegotiation(meetingCode: string, socketId: string): Promise<void> {
    const session = this.getSession(meetingCode, socketId);
    if (!session || session.pc.signalingState === 'closed') {
      return;
    }

    if (session.isNegotiating || session.pc.signalingState !== 'stable') {
      session.pendingRenegotiation = true;
      return;
    }

    session.isNegotiating = true;
    try {
      const offer = await session.pc.createOffer();
      await session.pc.setLocalDescription(offer);
      session.onRenegotiationOffer?.(session.socketId, {
        type: offer.type,
        sdp: offer.sdp,
      });
    } catch (err) {
      session.isNegotiating = false;
      console.error('Failed to trigger renegotiation:', err);
    }
  }

  public async createPublisherConnection(
    meetingCode: string,
    socketId: string,
    userId: string,
    onIceCandidate: (candidate: any) => void,
    onRenegotiationOffer: (targetSocketId: string, offer: any) => void
  ): Promise<RTCPeerConnection> {
    this.closeConnection(meetingCode, socketId);

    const iceServers: any[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (process.env.TURN_SERVER_URL) {
      iceServers.push({
        urls: process.env.TURN_SERVER_URL,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_PASSWORD,
      });
    }

    const pc = new RTCPeerConnection({
      iceServers,
    });

    const key = this.getSessionKey(meetingCode, socketId);
    const earlyCandidates = this.earlyIceCandidates.get(key) || [];
    this.earlyIceCandidates.delete(key);

    const session: PeerSession = {
      socketId,
      userId,
      meetingCode,
      pc,
      isMuted: false,
      tracks: new Map(),
      isNegotiating: false,
      pendingRenegotiation: false,
      pendingIceCandidates: [...earlyCandidates],
      onRenegotiationOffer,
    };
    this.sessions.set(key, session);

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

      if (track.kind === 'audio') {
        const originalApply = track.applyIncomingRtp.bind(track);
        track.applyIncomingRtp = (packet: any, extensions: any) => {
          if (session.isMuted) {
            return;
          }
          originalApply(packet, extensions);
        };
      }

      const otherSessions = Array.from(this.sessions.values()).filter(
        (s) => s.meetingCode === meetingCode && s.socketId !== socketId
      );

      for (const otherSession of otherSessions) {
        try {
          const alreadyAdded = otherSession.pc.getSenders().some((s) => s.track?.uuid === track.uuid);
          if (!alreadyAdded) {
            otherSession.pc.addTrack(track);
            await this.triggerRenegotiation(meetingCode, otherSession.socketId);
          }
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
    const session = this.getSession(meetingCode, socketId);
    if (session) {
      await this.flushPendingIceCandidates(session);
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    const existingPeers = roomBroker.getPeers(meetingCode).filter((p) => p.socketId !== socketId);
    let hasExistingTracks = false;
    for (const peer of existingPeers) {
      for (const track of peer.tracks.values()) {
        const alreadyAdded = pc.getSenders().some((s) => s.track?.uuid === track.uuid);
        if (!alreadyAdded) {
          try {
            pc.addTrack(track);
            hasExistingTracks = true;
          } catch (err) {
            console.error('Failed to add existing track to new peer:', err);
          }
        }
      }
    }

    if (hasExistingTracks) {
      setTimeout(() => {
        this.triggerRenegotiation(meetingCode, socketId);
      }, 100);
    }

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
    await this.flushPendingIceCandidates(session);
    session.isNegotiating = false;

    if (session.pendingRenegotiation) {
      session.pendingRenegotiation = false;
      await this.triggerRenegotiation(meetingCode, socketId);
    }
  }

  public async handleIceCandidate(meetingCode: string, socketId: string, candidate: any): Promise<void> {
    if (!candidate) {
      return;
    }

    const key = this.getSessionKey(meetingCode, socketId);
    const session = this.sessions.get(key);

    if (!session) {
      const list = this.earlyIceCandidates.get(key) || [];
      list.push(candidate);
      this.earlyIceCandidates.set(key, list);
      return;
    }

    if (!session.pc.remoteDescription) {
      session.pendingIceCandidates.push(candidate);
      return;
    }

    await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  public setPeerMuteStatus(meetingCode: string, userId: string, isMuted: boolean): void {
    const matchingSessions = Array.from(this.sessions.values()).filter(
      (s) => s.meetingCode === meetingCode && s.userId === userId
    );

    for (const session of matchingSessions) {
      session.isMuted = isMuted;
      for (const track of session.tracks.values()) {
        if (track.kind === 'audio') {
          track.muted = isMuted;
          track.enabled = !isMuted;
        }
      }
    }
  }

  public closeConnection(meetingCode: string, socketId: string): void {
    const key = this.getSessionKey(meetingCode, socketId);
    this.earlyIceCandidates.delete(key);
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
        this.earlyIceCandidates.delete(key);
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
        this.earlyIceCandidates.delete(key);
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
