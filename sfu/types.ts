import type { MediaStreamTrack, RTCRtpSender, RTCPeerConnection } from 'werift';
import type { SrtpSession } from './protocols/srtp/srtpPacket.js';
import type { DtlsServerHandshake } from './protocols/dtls/dtlsHandshake.js';

export interface Peer {
    id: string;
    name: string;
    socketId: string;
    peerConnection?: RTCPeerConnection;
    publishedTracks: Map<string, PublishedTrack>;
    inboundSrtpSession?: SrtpSession;
    outboundSrtpSession?: SrtpSession;
    dtlsHandshake?: DtlsServerHandshake;
}

export interface PublishedTrack {
    trackId: string;
    kind: 'audio' | 'video';
    peerId: string;
    mediaStreamTrack: MediaStreamTrack;
    ssrc?: number;
    rtpSubscription?: { unSubscribe: () => void };
}

export interface SfuRoom {
    code: string;
    hostId?: string;
    peers: Map<string, Peer>;
    channels: Map<string, TrackSubscriber[]>;
}

export interface TrackSubscriber {
    subscriberPeerId: string;
    sender: RTCRtpSender;
}
