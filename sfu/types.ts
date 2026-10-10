import { MediaStreamTrack } from 'werift';

export interface SfuPeer {
  userId: string;
  socketId: string;
  joinedAt: Date;
  tracks: Map<string, MediaStreamTrack>;
}

export interface SfuRoom {
  meetingCode: string;
  peers: Map<string, SfuPeer>;
}
