import redis from '../config/redis.js';
import prisma from '../config/prisma.js';
import logger from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { OrgRole, MeetingStatus } from '@prisma/client';
import { closeMeetingRoom } from '../sockets/meetingPresence.js';
import {
    OfficeZoneId,
    OfficeDesk,
    OfficeMember,
    OfficeState,
    OfficeKnockPayload,
    OfficeKnockedEvent,
    OfficeZoneChangedEvent,
    DeskOccupancyStatus,
} from '../types/office.js';
import {
    getUserPresence,
    setUserCustomStatus,
    clearUserCustomStatus,
    setMeetingPresence,
    getMultipleUserPresences,
    PresenceStatus,
} from './presenceService.js';

const TOTAL_OFFICE_DESKS = 12;
const KNOCK_COOLDOWN_SECONDS = 30;

/// Redis Key Generators
const getOfficeMeetingKey = (teamId: string) => `office:team:${teamId}:meeting`;
const getOfficeMeetingMetaKey = (teamId: string) => `office:team:${teamId}:meeting:meta`;
const getOfficeMembersKey = (teamId: string) => `office:team:${teamId}:members`;
const getOfficeDesksKey = (teamId: string) => `office:team:${teamId}:desks`;
const getKnockCooldownKey = (senderId: string, targetId: string) =>
    `office:knock:${senderId}:${targetId}`;

//Generate a clean default 12-desk layout

function createDefaultDesks(): OfficeDesk[] {
    return Array.from({ length: TOTAL_OFFICE_DESKS }, (_, i) => ({
        deskId: `desk_${i + 1}`,
        deskNumber: i + 1,
        occupiedByUserId: null,
        occupiedByUserName: null,
        occupiedByUserAvatar: null,
        status: 'EMPTY' as DeskOccupancyStatus,
    }));
}

/**
 * Map presence status to appropriate desk status
 */
function mapPresenceToDeskStatus(status: PresenceStatus): DeskOccupancyStatus {
    if (status === 'BUSY') return 'BUSY';
    if (status === 'AWAY') return 'AWAY';
    if (status === 'AVAILABLE') return 'AVAILABLE';
    return 'AVAILABLE';
}

/**
 * 1. Fetch full snapshot of team's virtual office floor
 */
export async function getOfficeFloorState(teamId: string): Promise<OfficeState> {
    const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: {
            id: true,
            organizationId: true,
            members: {
                select: {
                    userId: true,
                    user: { select: { id: true, name: true, avatar: true } },
                },
            },
        },
    });

    if (!team) {
        throw new ApiError(404, 'Team not found');
    }

    const membersKey = getOfficeMembersKey(teamId);
    const desksKey = getOfficeDesksKey(teamId);
    const meetingKey = getOfficeMeetingKey(teamId);

    // Fetch in parallel from Redis
    const [rawMembers, rawDesksObj, activeMeetingCode] = await Promise.all([
        redis.hgetall(membersKey).catch(() => ({})),
        redis.hgetall(desksKey).catch(() => ({})),
        redis.get(meetingKey).catch(() => null),
    ]);

    const rawMembersMap = (rawMembers || {}) as Record<string, string>;
    const rawDesks = (rawDesksObj || {}) as Record<string, string>;
    const members: Record<string, OfficeMember> = {};
    const counts = {
        warRoom: 0,
        openDesks: 0,
        coffeeLounge: 0,
        focusPods: 0,
        totalActive: 0,
    };
    for (const tm of team.members) {
        const userId = tm.userId;
        const memberJson = rawMembersMap[userId];
        try {
            const parsed = memberJson ? JSON.parse(memberJson) : null;
            const presence = await getUserPresence(userId);
            // If user went completely offline, skip them
            if (!presence.isOnline) {
                await redis.hdel(membersKey, userId).catch(() => { });
                continue;
            }

            const isUserInThisMeeting = Boolean(
                presence.isInMeeting &&
                activeMeetingCode &&
                presence.meetingCode === activeMeetingCode
            );

            // If in another team's call, keep them at their Open Workspace desk
            let resolvedZoneId: OfficeZoneId = 'OPEN_WORKSPACE';
            let resolvedStatusMsg = presence.statusMessage || null;
            if (isUserInThisMeeting) {
                resolvedZoneId = 'WAR_ROOM';
            } else if (presence.isInMeeting) {
                resolvedZoneId = 'OPEN_WORKSPACE';
                resolvedStatusMsg = 'In another meeting';
            } else if (presence.status === 'DO_NOT_DISTURB') {
                resolvedZoneId = 'FOCUS_POD';
            } else if (presence.status === 'BE_RIGHT_BACK') {
                resolvedZoneId = 'COFFEE_LOUNGE';
            } else if (parsed?.zoneId && parsed.zoneId !== 'WAR_ROOM') {
                resolvedZoneId = parsed.zoneId;
            }

            const member: OfficeMember = {
                userId,
                name: tm.user.name,
                avatarUrl: tm.user.avatar || null,
                presenceStatus: presence.status,
                zoneId: resolvedZoneId,
                deskId: parsed?.deskId || null,
                isInMeeting: Boolean(presence.isInMeeting),
                statusMessage: resolvedStatusMsg,
                joinedOfficeAt: parsed?.joinedOfficeAt || new Date().toISOString(),
            };

            members[userId] = member;
            counts.totalActive++;

            // Tally room counts
            if (member.zoneId === 'WAR_ROOM') counts.warRoom++;
            else if (member.zoneId === 'OPEN_WORKSPACE') counts.openDesks++;
            else if (member.zoneId === 'COFFEE_LOUNGE') counts.coffeeLounge++;
            else if (member.zoneId === 'FOCUS_POD') counts.focusPods++;
        } catch {
            // Ignore corrupted entries
        }
    }

    // Auto-seat any online open workspace member at first available desk
    for (const member of Object.values(members)) {
        if (member.zoneId === 'OPEN_WORKSPACE' && !member.deskId) {
            for (let i = 1; i <= TOTAL_OFFICE_DESKS; i++) {
                const dId = `desk_${i}`;
                if (!rawDesks[dId]) {
                    rawDesks[dId] = member.userId;
                    member.deskId = dId;
                    break;
                }
            }
        }
    }

    // Construct 12 desks
    const defaultDesks = createDefaultDesks();
    const desks = defaultDesks.map((desk) => {
        const occupiedUserId = rawDesks[desk.deskId];
        if (occupiedUserId && members[occupiedUserId]) {
            const m = members[occupiedUserId];
            return {
                ...desk,
                occupiedByUserId: m.userId,
                occupiedByUserName: m.name,
                occupiedByUserAvatar: m.avatarUrl,
                status: mapPresenceToDeskStatus(m.presenceStatus),
            };
        }
        return desk;
    });

    return {
        teamId,
        organizationId: team.organizationId,
        members,
        desks,
        activeMeetingCode,
        counts,
    };
}

/**
 * 2. Join the team's virtual office floor
 */
export async function joinOffice(
    teamId: string,
    user: { id: string; name: string; avatarUrl?: string | null }
): Promise<{ state: OfficeState; member: OfficeMember }> {
    const presence = await getUserPresence(user.id);
    const meetingKey = getOfficeMeetingKey(teamId);
    const activeMeetingCode = await redis.get(meetingKey).catch(() => null);

    // Check if user is in THIS team's active meeting
    const isInThisTeamMeeting = Boolean(
        presence.isInMeeting &&
        activeMeetingCode &&
        presence.meetingCode === activeMeetingCode
    );

    // Auto-determine initial zone based on current presence
    let initialZone: OfficeZoneId = 'OPEN_WORKSPACE';
    if (isInThisTeamMeeting) {
        initialZone = 'WAR_ROOM';
    } else if (presence.status === 'DO_NOT_DISTURB') {
        initialZone = 'FOCUS_POD';
    } else if (presence.status === 'BE_RIGHT_BACK') {
        initialZone = 'COFFEE_LOUNGE';
    }


    const desksKey = getOfficeDesksKey(teamId);
    const membersKey = getOfficeMembersKey(teamId);

    // If in open workspace, auto-assign first available desk
    let assignedDeskId: string | null = null;
    if (initialZone === 'OPEN_WORKSPACE') {
        const rawDesks = (await redis.hgetall(desksKey).catch(() => ({}))) as Record<string, string>;
        for (let i = 1; i <= TOTAL_OFFICE_DESKS; i++) {
            const dId = `desk_${i}`;
            if (!rawDesks[dId]) {
                assignedDeskId = dId;
                await redis.hset(desksKey, dId, user.id);
                break;
            }
        }
    }

    const member: OfficeMember = {
        userId: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl || null,
        presenceStatus: presence.status,
        zoneId: initialZone,
        deskId: assignedDeskId,
        isInMeeting: Boolean(presence.isInMeeting),
        statusMessage: presence.statusMessage || null,
        joinedOfficeAt: new Date().toISOString(),
    };

    await redis.hset(membersKey, user.id, JSON.stringify(member));
    logger.info(`User ${user.id} joined virtual office for team ${teamId} in zone ${initialZone}`);

    const state = await getOfficeFloorState(teamId);
    return { state, member };
}

/**
 * 3. Change room / zone inside the virtual office
 */
export async function changeOfficeZone(
    teamId: string,
    userId: string,
    newZoneId: OfficeZoneId,
    targetDeskId?: string | number | null,
    durationMinutes?: number | null
): Promise<OfficeZoneChangedEvent> {
    const membersKey = getOfficeMembersKey(teamId);
    const desksKey = getOfficeDesksKey(teamId);

    if (targetDeskId !== undefined && targetDeskId !== null) {
        const str = String(targetDeskId).trim();
        targetDeskId = /^\d+$/.test(str) ? `desk_${str}` : str;
    }

    let rawMember = await redis.hget(membersKey, userId);
    let currentMember: OfficeMember;
    if (!rawMember) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, avatar: true },
        });
        if (!user) throw new ApiError(404, 'User not found');
        const joinResult = await joinOffice(teamId, { id: userId, name: user.name, avatarUrl: user.avatar });
        currentMember = joinResult.member;
    } else {
        currentMember = JSON.parse(rawMember as string) as OfficeMember;
    }
    const previousZoneId = currentMember.zoneId;

    // Free previous desk if moving away from open workspace
    if (currentMember.deskId && newZoneId !== 'OPEN_WORKSPACE') {
        await redis.hdel(desksKey, currentMember.deskId).catch(() => { });
        currentMember.deskId = null;
    }

    // Handle desk assignment if entering open workspace
    let finalDeskId = currentMember.deskId;
    if (newZoneId === 'OPEN_WORKSPACE') {
        const rawDesks = (await redis.hgetall(desksKey).catch(() => ({}))) as Record<string, string>;
        if (targetDeskId) {
            // Check if target desk is taken
            const occupiedBy = rawDesks[targetDeskId];
            if (occupiedBy && occupiedBy !== userId) {
                const isOccupantActive = await redis.hexists(membersKey, occupiedBy);
                if (isOccupantActive) {
                    throw new ApiError(409, 'This desk is already occupied by a teammate');
                }
                await redis.hdel(desksKey, targetDeskId).catch(() => { });
            }
            if (currentMember.deskId && currentMember.deskId !== targetDeskId) {
                await redis.hdel(desksKey, currentMember.deskId).catch(() => { });
            }
            await redis.hset(desksKey, targetDeskId, userId);
            finalDeskId = targetDeskId;
        } else if (!finalDeskId) {
            // Find first free desk
            for (let i = 1; i <= TOTAL_OFFICE_DESKS; i++) {
                const dId = `desk_${i}`;
                if (!rawDesks[dId]) {
                    finalDeskId = dId;
                    await redis.hset(desksKey, dId, userId);
                    break;
                }
            }
        }
    }

    // If moving out of War Room back to open workspace, clear meeting presence
    if (previousZoneId === 'WAR_ROOM' && newZoneId !== 'WAR_ROOM') {
        await setMeetingPresence(userId, false).catch(() => { });
    }

    // Bidirectional Presence synchronization:
    if (newZoneId === 'FOCUS_POD') {
        await setUserCustomStatus(userId, {
            status: 'DO_NOT_DISTURB',
            statusMessage: durationMinutes ? `Focus Pod (${durationMinutes}m)` : 'In Focus Pod',
            clearAfterMinutes: durationMinutes || null,
        });
    } else if (newZoneId === 'COFFEE_LOUNGE') {
        await setUserCustomStatus(userId, { status: 'BE_RIGHT_BACK', statusMessage: 'Coffee Break' });
    } else if (newZoneId === 'OPEN_WORKSPACE' && (previousZoneId === 'FOCUS_POD' || previousZoneId === 'COFFEE_LOUNGE')) {
        await clearUserCustomStatus(userId);
    }

    const updatedPresence = await getUserPresence(userId);

    // Update member in Redis
    currentMember.zoneId = newZoneId;
    currentMember.deskId = finalDeskId;
    currentMember.presenceStatus = updatedPresence.status;
    currentMember.statusMessage = updatedPresence.statusMessage || null;

    await redis.hset(membersKey, userId, JSON.stringify(currentMember));

    logger.info(`User ${userId} moved from ${previousZoneId} to ${newZoneId} in team office ${teamId}`);

    return {
        teamId,
        userId,
        name: currentMember.name,
        avatarUrl: currentMember.avatarUrl,
        previousZoneId,
        newZoneId,
        deskId: finalDeskId,
        presenceStatus: updatedPresence.status,
        isInMeeting: Boolean(updatedPresence.isInMeeting),
        statusMessage: updatedPresence.statusMessage,
        timestamp: new Date().toISOString(),
    };
}

/**
 * 4. Knock on a colleague's desk
 */
export async function knockOnDesk(
    payload: OfficeKnockPayload,
    sender: { id: string; name: string; avatarUrl?: string | null }
): Promise<OfficeKnockedEvent> {
    const { teamId, targetUserId, message } = payload;

    if (sender.id === targetUserId) {
        throw new ApiError(400, 'You cannot knock on your own desk');
    }

    const membersKey = getOfficeMembersKey(teamId);
    const targetRaw = await redis.hget(membersKey, targetUserId);

    if (!targetRaw) {
        throw new ApiError(404, 'Teammate is not currently in the virtual office');
    }

    const targetMember = JSON.parse(targetRaw as string) as OfficeMember;
    if (targetMember.zoneId === 'FOCUS_POD' || targetMember.presenceStatus === 'DO_NOT_DISTURB') {
        throw new ApiError(403, `${targetMember.name} is in a Focus Pod (Do Not Disturb) and cannot be knocked`);
    }

    // Anti-spam rate limiting: 1 knock every 30 seconds
    const cooldownKey = getKnockCooldownKey(sender.id, targetUserId);
    const wasSet = await redis.set(cooldownKey, '1', 'EX', KNOCK_COOLDOWN_SECONDS, 'NX');

    if (!wasSet) {
        throw new ApiError(429, 'You already knocked on this desk. Please wait 30 seconds before knocking again.');
    }

    logger.info(`User ${sender.id} (${sender.name}) knocked on desk of ${targetUserId}`);

    return {
        senderId: sender.id,
        senderName: sender.name,
        senderAvatar: sender.avatarUrl || null,
        teamId,
        message: message?.trim() || `${sender.name} knocked on your desk!`,
        timestamp: new Date().toISOString(),
    };
}

/**
 * 5. Leave the virtual office floor
 */
export async function leaveOffice(teamId: string, userId: string): Promise<void> {
    const membersKey = getOfficeMembersKey(teamId);
    const desksKey = getOfficeDesksKey(teamId);

    const rawMember = await redis.hget(membersKey, userId);
    if (rawMember) {
        try {
            const parsed = JSON.parse(rawMember as string) as OfficeMember;
            if (parsed.deskId) {
                await redis.hdel(desksKey, parsed.deskId).catch(() => { });
            }
        } catch { }
    }

    await redis.hdel(membersKey, userId).catch(() => { });
    logger.info(`User ${userId} left virtual office for team ${teamId}`);
}



//6. Start an active video meeting in the War Room with host role tracking

export async function startWarRoomMeeting(
    teamId: string,
    meetingCode: string,
    startedBy: { id: string; name: string }
): Promise<{ teamId: string; meetingCode: string; startedById: string; startedByName: string; startedByRole: string; startedAt: string }> {
    const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: {
            id: true,
            organizationId: true,
            organization: { select: { ownerId: true } },
        },
    });

    if (!team) {
        throw new ApiError(404, 'Team not found');
    }

    // Determine starter's role in the organization and team
    let starterRole: 'OWNER' | 'ORG_ADMIN' | 'LEAD' | 'MEMBER' = 'MEMBER';
    if (team.organization?.ownerId === startedBy.id) {
        starterRole = 'OWNER';
    } else {
        const orgMember = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: team.organizationId, userId: startedBy.id } },
            select: { role: true },
        });

        if (orgMember?.role === OrgRole.ORG_ADMIN) {
            starterRole = 'ORG_ADMIN';
        } else {
            const teamMember = await prisma.teamMember.findUnique({
                where: { teamId_userId: { teamId, userId: startedBy.id } },
                select: { role: true },
            });
            if (teamMember?.role === 'LEAD') {
                starterRole = 'LEAD';
            }
        }
    }

    const meetingKey = getOfficeMeetingKey(teamId);
    const meetingMetaKey = getOfficeMeetingMetaKey(teamId);
    const cleanCode = meetingCode.trim().toLowerCase();

    const metaPayload = {
        meetingCode: cleanCode,
        startedById: startedBy.id,
        startedByName: startedBy.name,
        startedByRole: starterRole,
        startedAt: new Date().toISOString(),
    };

    // Store active meeting code AND detailed metadata with 24hr TTL
    await Promise.all([
        redis.set(meetingKey, cleanCode, 'EX', 86400),
        redis.set(meetingMetaKey, JSON.stringify(metaPayload), 'EX', 86400),
    ]);

    logger.info(`War Room meeting started for team ${teamId} by ${startedBy.name} (${starterRole})`);

    return {
        teamId,
        ...metaPayload,
    };
}


// 7. End active video meeting in War Room with strict RBAC protection

export async function endWarRoomMeeting(
    teamId: string,
    callerUserId: string
): Promise<{ teamId: string; meetingCode: string }> {
    const meetingKey = getOfficeMeetingKey(teamId);
    const meetingMetaKey = getOfficeMeetingMetaKey(teamId);

    const [cleanCode, rawMeta] = await Promise.all([
        redis.get(meetingKey),
        redis.get(meetingMetaKey),
    ]);

    if (!cleanCode) {
        throw new ApiError(404, 'No active War Room meeting found for this team');
    }

    let meta: { meetingCode: string; startedById: string; startedByName: string; startedByRole: string } | null = null;
    if (rawMeta) {
        try {
            meta = JSON.parse(rawMeta);
        } catch { }
    }

    // Fetch caller's organization and team role
    const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: {
            id: true,
            organizationId: true,
            organization: { select: { ownerId: true } },
        },
    });

    if (!team) {
        throw new ApiError(404, 'Team not found');
    }

    const isOwner = team.organization?.ownerId === callerUserId;
    let isOrgAdmin = isOwner;
    let isTeamLead = false;

    if (!isOrgAdmin) {
        const orgMember = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: team.organizationId, userId: callerUserId } },
            select: { role: true },
        });
        if (orgMember?.role === OrgRole.ORG_ADMIN) {
            isOrgAdmin = true;
        }
    }

    const teamMember = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: callerUserId } },
        select: { role: true },
    });
    if (teamMember?.role === 'LEAD') {
        isTeamLead = true;
    }

    const isStarter = meta?.startedById === callerUserId;

    // RBAC Permission Evaluation:
    // 1. If Org Admin started it -> ONLY Org Admin (or starter) can end it
    if (meta?.startedByRole === 'ORG_ADMIN' || meta?.startedByRole === 'OWNER') {
        if (!isOrgAdmin && !isStarter) {
            throw new ApiError(403, 'This meeting was started by an Organization Admin. Only an Organization Admin can end it.');
        }
    }
    // 2. If Team Lead started it -> Either Team Lead or Org Admin can end it
    else if (meta?.startedByRole === 'LEAD') {
        if (!isOrgAdmin && !isTeamLead && !isStarter) {
            throw new ApiError(403, 'This meeting was started by a Team Lead. Only a Team Lead or Org Admin can end it.');
        }
    }
    // 3. Regular Member protection -> Members who are NOT the host cannot end it
    else {
        if (!isOrgAdmin && !isTeamLead && !isStarter) {
            throw new ApiError(403, 'Only the meeting host, team lead, or an organization admin can end this meeting.');
        }
    }

    // Authorized: Clear Redis state
    await Promise.all([
        redis.del(meetingKey),
        redis.del(meetingMetaKey),
    ]);

    await setMeetingPresence(callerUserId, false).catch(() => { });
    if (meta?.startedById && meta.startedById !== callerUserId) {
        await setMeetingPresence(meta.startedById, false).catch(() => { });
    }

    // Mark meeting as ENDED in database if present
    await prisma.meeting.updateMany({
        where: { code: cleanCode, status: { not: MeetingStatus.ENDED } },
        data: { status: MeetingStatus.ENDED },
    }).catch(() => { });

    // Disconnect socket & WebRTC room
    try {
        closeMeetingRoom(cleanCode);
    } catch (err: any) {
        logger.warn(`[OfficeMeeting] Socket room teardown notice: ${err?.message}`);
    }

    logger.info(`War Room meeting ${cleanCode} ended for team ${teamId} by user ${callerUserId}`);

    return { teamId, meetingCode: cleanCode };
}