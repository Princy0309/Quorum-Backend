import { MediaKind } from '../publisher.js';
import { RtpForwarderStats } from '../rtpForwarder.js';

export interface PublishedTrackInfo {
  trackId: string;
  peerId: string;
  kind: MediaKind;
  ssrc: number;
  payloadType: number;
}

export interface TrackRouterStats {
  roomCode: string;
  activeTracksCount: number;
  publishersCount: number;
  totalSubscribersCount: number;
  forwardersStats: Record<string, RtpForwarderStats>;
}

export interface TrackPublishedEvent {
  roomCode: string;
  trackId: string;
  peerId: string;
  kind: MediaKind;
  ssrc: number;
  payloadType: number;
}

export interface TrackUnpublishedEvent {
  roomCode: string;
  trackId: string;
  peerId?: string;
}

export interface SubscriptionEvent {
  roomCode: string;
  trackId: string;
  subscriberPeerId: string;
  subscriberId: string;
}

export interface UnsubscriptionEvent {
  roomCode: string;
  trackId: string;
  subscriberId: string;
}
