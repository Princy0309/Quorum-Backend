import { PresenceStatus } from '../services/presenceService.js';
export type OfficeZoneId = 'WAR_ROOM' | 'OPEN_WORKSPACE' | 'COFFEE_LOUNGE' | 'FOCUS_POD';
export type DeskOccupancyStatus = 'AVAILABLE' | 'BUSY' | 'AWAY' | 'EMPTY';

export interface OfficeDesk {
  deskId: string;
  deskNumber: number;
  occupiedByUserId?: string | null;
  occupiedByUserName?: string | null;
  occupiedByUserAvatar?: string | null;
  status: DeskOccupancyStatus;
}

export interface OfficeMember {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  presenceStatus: PresenceStatus;
  zoneId: OfficeZoneId;
  deskId?: string | null;
  isInMeeting: boolean;
  statusMessage?: string | null;
  joinedOfficeAt: string;
}

export interface OfficeState {
  teamId: string;
  organizationId: string;
  members: Record<string, OfficeMember>;
  desks: OfficeDesk[];
  activeMeetingCode?: string | null;
  counts: {
    warRoom: number;
    openDesks: number;
    coffeeLounge: number;
    focusPods: number;
    totalActive: number;
  };
}

export interface OfficeKnockPayload {
  teamId: string;
  targetUserId: string;
  message?: string;
}

export interface OfficeKnockedEvent {
  senderId: string;
  senderName: string;
  senderAvatar?: string | null;
  teamId: string;
  message?: string;
  timestamp: string;
}

export interface OfficeZoneChangedEvent {
  teamId: string;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  previousZoneId?: OfficeZoneId | null;
  newZoneId: OfficeZoneId;
  deskId?: string | null;
  presenceStatus: PresenceStatus;
  isInMeeting: boolean;
  statusMessage?: string | null;
  timestamp: string;
}
