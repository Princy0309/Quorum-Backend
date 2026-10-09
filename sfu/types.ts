export interface SfuPeer {
  userId: string;
  socketId: string;
  joinedAt: Date;
}

export interface SfuRoom {
  meetingCode: string;
  peers: Map<string, SfuPeer>;
}
