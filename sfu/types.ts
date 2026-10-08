import type {MediaStreamTrack, RTCRtpSender, RTCPeerConnection } from 'werift';


export interface Peer {
    id: string;
    name: string;
    socketId: string;
    peerConnection?: RTCPeerConnection;
    publishedTracks: Map<string, PublishedTrack>;

}

export interface PublishedTrack {
    trackId: string;
    kind: 'audio' | 'video';
    peerId: string;
    mediaStreamTrack: MediaStreamTrack;
}

export interface SfuRoom {
    code: string;
    hostId: string;
    peers: Map<string, Peer>;
    channels: Map<string, TrackSubscriber[]>;
}

export interface TrackSubscriber {
    subscriberPeerId: string;
    sender: RTCRtpSender;
}
