import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { getIO } from '../sockets/socketServer.js';
import logger from '../utils/logger.js';
import type { CreateEventInput, UpdateEventInput } from '../types/index.js';
import { scheduleEventReminder, cancelEventReminder } from '../queues/reminderQueue.js';
import { addMeetingInviteEmailToQueue } from '../queues/emailQueue.js';


export const createCalendarEvent = async (userId: string, input: CreateEventInput) => {
    const creator = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
    });

    if (!creator) {
        throw new ApiError(404, 'User not found');
    }

    const start = new Date(input.startDate);
    const end = input.endDate ? new Date(input.endDate) : new Date(start.getTime() + 60 * 60 * 1000);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new ApiError(400, 'Invalid date format');
    }

    if (end < start) {
        throw new ApiError(400, 'End date cannot be earlier than start date');
    }

    const now = Date.now();
    const gracePeriodMs = 60 * 1000; // 60s grace period for submission latency and clock drift

    if (input.isAllDay) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        if (start.getTime() < startOfToday.getTime()) {
            throw new ApiError(400, 'Event start date cannot be before today');
        }
    } else {
        if (start.getTime() < now - gracePeriodMs) {
            throw new ApiError(400, 'Event start date cannot be in the past');
        }
    }


    const event = await prisma.calendarEvent.create({
        data: {
            userId,
            title: input.title,
            description: input.description,
            eventType: input.eventType || 'REMINDER',
            startDate: start,
            endDate: end,
            isAllDay: input.isAllDay ?? false,
            meetingLink: input.meetingLink,
            attendeeEmails: input.attendeeEmails || [],
            hasReminder: input.hasReminder ?? false,
            reminderMinutes: input.reminderMinutes ?? 15,
        },
    });

    if (input.eventType === 'MEETING' && input.attendeeEmails && input.attendeeEmails.length > 0) {
        try {
            const attendees = await prisma.user.findMany({
                where: { email: { in: input.attendeeEmails } },
                select: { id: true, email: true },
            });

            for (const attendee of attendees) {
                if (attendee.id === userId) continue;
                try {
                    const notif = await prisma.notification.create({
                        data: {
                            recipientId: attendee.id,
                            actorId: userId,
                            type: 'EVENT_REMINDER',
                            title: `Meeting Scheduled: ${input.title}`,
                            body: `${creator.name} scheduled a meeting for ${start.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} at ${start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`,
                            data: {
                                eventId: event.id,
                                meetingLink: input.meetingLink || '',
                                startDate: start.toISOString(),
                            },
                        },
                    });

                    try {
                        const io = getIO();
                        io.to(`user:${attendee.id}`).emit('notification:new', notif);
                    } catch (socketErr: unknown) {
                        const msg = socketErr instanceof Error ? socketErr.message : String(socketErr);
                        logger.warn(`Could not emit real-time socket notification for event ${event.id} to user ${attendee.id}: ${msg}`);
                    }
                } catch (notifErr: unknown) {
                    const msg = notifErr instanceof Error ? notifErr.message : String(notifErr);
                    logger.warn(`Could not create notification in DB for event ${event.id} and attendee ${attendee.id}: ${msg}`);
                }
                addMeetingInviteEmailToQueue({
                    email: attendee.email,
                    inviterName: creator.name,
                    meetingTitle: input.title,
                    formattedDate: `${start.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} at ${start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`,
                    meetingLink: input.meetingLink,
                }).catch((mailErr: unknown) => {
                    const msg = mailErr instanceof Error ? mailErr.message : String(mailErr);
                    logger.warn(`Could not queue meeting invite email for ${attendee.email}: ${msg}`);
                });

            }
        } catch (lookupErr: unknown) {
            const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
            logger.warn(`Failed attendee lookup for event ${event.id}: ${msg}`);
        }
    }


    if (input.hasReminder) {
        try {
            const reminderNotif = await prisma.notification.create({
                data: {
                    recipientId: userId,
                    actorId: userId,
                    type: 'EVENT_REMINDER',
                    title: `Reminder Set: ${input.title}`,
                    body: `Scheduled for ${start.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} at ${start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`,
                    data: {
                        eventId: event.id,
                        startDate: start.toISOString(),
                    },
                },
            });

            try {
                const io = getIO();
                io.to(`user:${userId}`).emit('notification:new', reminderNotif);
            } catch (socketErr: unknown) {
                const msg = socketErr instanceof Error ? socketErr.message : String(socketErr);
                logger.warn(`Could not emit real-time socket notification: ${msg}`);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn(`Could not create reminder confirmation: ${message}`);
        }

    }

    await scheduleEventReminder(event);

    return event;
};


export const getCalendarEventsByMonth = async (userId: string, year: number, month: number) => {
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    return await prisma.calendarEvent.findMany({
        where: {
            userId,
            startDate: { lt: endOfMonth },
            OR: [
                { endDate: { gte: startOfMonth } },
                { endDate: null, startDate: { gte: startOfMonth } },
            ],
        },
        orderBy: { startDate: 'asc' },
    });
};

export const getCalendarEventsByDate = async (userId: string, dateStr: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new ApiError(400, 'Date must be in format YYYY-MM-DD');
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

    if (
        startOfDay.getUTCFullYear() !== year ||
        startOfDay.getUTCMonth() !== month - 1 ||
        startOfDay.getUTCDate() !== day
    ) {
        throw new ApiError(400, 'Invalid calendar date');
    }

    const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));

    return await prisma.calendarEvent.findMany({
        where: {
            userId,
            startDate: { lt: nextDay },
            OR: [
                { endDate: { gte: startOfDay } },
                { endDate: null, startDate: { gte: startOfDay } },
            ],
        },
        orderBy: { startDate: 'asc' },
    });
};



export const getUpcomingCalendarEvents = async (userId: string, limit: number = 5) => {
    const now = new Date();

    return await prisma.calendarEvent.findMany({
        where: {
            userId,
            startDate: {
                gte: now,
            },
        },
        take: limit,
        orderBy: { startDate: 'asc' },
    });
};

export const getCalendarEventById = async (userId: string, eventId: string) => {
    const existing = await prisma.calendarEvent.findFirst({
        where: { id: eventId, userId },
    });

    if (!existing) {
        throw new ApiError(404, 'Calendar event not found');
    }

    return existing;
};

export const updateCalendarEvent = async (userId: string, eventId: string, input: UpdateEventInput) => {
    const existing = await prisma.calendarEvent.findFirst({
        where: { id: eventId, userId },
    });

    if (!existing) {
        throw new ApiError(404, 'Calendar event not found');
    }

    if (input.title !== undefined) {
        const trimmedTitle = input.title.trim();
        if (!trimmedTitle) {
            throw new ApiError(400, 'Title cannot be empty');
        }
    }

    if (input.startDate !== undefined && !input.startDate.trim()) {
        throw new ApiError(400, 'Start date cannot be empty');
    }
    if (input.endDate !== undefined && input.endDate !== null && !input.endDate.trim()) {
        throw new ApiError(400, 'End date cannot be empty');
    }


    const effectiveStart = input.startDate ? new Date(input.startDate) : existing.startDate;
    let effectiveEnd = input.endDate !== undefined
        ? (input.endDate ? new Date(input.endDate) : null)
        : existing.endDate;

    if (isNaN(effectiveStart.getTime()) || (effectiveEnd && isNaN(effectiveEnd.getTime()))) {
        throw new ApiError(400, 'Invalid date format');
    }

    if (effectiveEnd && effectiveEnd < effectiveStart) {
        if (input.endDate === undefined && existing.endDate && existing.startDate) {
            const existingDuration = Math.max(existing.endDate.getTime() - existing.startDate.getTime(), 60 * 60 * 1000);
            effectiveEnd = new Date(effectiveStart.getTime() + existingDuration);
        } else {
            throw new ApiError(400, 'End date cannot be earlier than start date');
        }
    }

    if (input.startDate !== undefined) {
        const newStart = new Date(input.startDate);
        const isAllDay = input.isAllDay !== undefined ? input.isAllDay : existing.isAllDay;
        const now = Date.now();
        const gracePeriodMs = 60 * 1000;

        if (isAllDay) {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            if (newStart.getTime() < startOfToday.getTime()) {
                throw new ApiError(400, 'Event start date cannot be before today');
            }
        } else {
            if (newStart.getTime() < now - gracePeriodMs) {
                throw new ApiError(400, 'Event start date cannot be in the past');
            }
        }
    }

    const datesOrReminderChanged =
        input.startDate !== undefined ||
        input.endDate !== undefined ||
        input.reminderMinutes !== undefined ||
        input.hasReminder !== undefined;

    const updated = await prisma.calendarEvent.update({
        where: { id: existing.id },
        data: {
            ...(input.title !== undefined && { title: input.title.trim() }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.eventType && { eventType: input.eventType }),
            ...(input.startDate != undefined && { startDate: new Date(input.startDate) }),
            ...(input.endDate !== undefined
                ? { endDate: input.endDate ? new Date(input.endDate) : null }
                : (effectiveEnd !== existing.endDate ? { endDate: effectiveEnd } : {})),
            ...(input.isAllDay !== undefined && { isAllDay: input.isAllDay }),
            ...(input.meetingLink !== undefined && { meetingLink: input.meetingLink }),
            ...(input.attendeeEmails && { attendeeEmails: input.attendeeEmails }),
            ...(input.hasReminder !== undefined && { hasReminder: input.hasReminder }),
            ...(input.reminderMinutes !== undefined && { reminderMinutes: input.reminderMinutes }),
            ...(datesOrReminderChanged && { isNotified: false }),
        },
    });

    const effectiveType = input.eventType || existing.eventType;
    const effectiveEmails = input.attendeeEmails || existing.attendeeEmails;
    const meetingDetailsChanged =
        input.startDate !== undefined ||
        input.endDate !== undefined ||
        input.meetingLink !== undefined ||
        input.title !== undefined ||
        input.attendeeEmails !== undefined;

    if (effectiveType === 'MEETING' && effectiveEmails && effectiveEmails.length > 0 && meetingDetailsChanged) {
        try {
            const attendees = await prisma.user.findMany({
                where: { email: { in: effectiveEmails } },
                select: { id: true, email: true },
            });

            const creator = await prisma.user.findUnique({
                where: { id: userId },
                select: { name: true },
            });

            for (const attendee of attendees) {
                if (attendee.id === userId) continue;
                try {
                    const notif = await prisma.notification.create({
                        data: {
                            recipientId: attendee.id,
                            actorId: userId,
                            type: 'EVENT_REMINDER',
                            title: `Meeting Updated: ${updated.title}`,
                            body: `${creator?.name || 'Organizer'} updated the meeting scheduled for ${effectiveStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} at ${effectiveStart.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`,
                            data: {
                                eventId: updated.id,
                                meetingLink: updated.meetingLink || '',
                                startDate: effectiveStart.toISOString(),
                            },
                        },
                    });

                    try {
                        const io = getIO();
                        io.to(`user:${attendee.id}`).emit('notification:new', notif);
                    } catch (socketErr: unknown) {
                        const msg = socketErr instanceof Error ? socketErr.message : String(socketErr);
                        logger.warn(`Could not emit update socket notification for event ${updated.id} to user ${attendee.id}: ${msg}`);
                    }
                } catch (notifErr: unknown) {
                    const msg = notifErr instanceof Error ? notifErr.message : String(notifErr);
                    logger.warn(`Could not create update notification for event ${updated.id} and attendee ${attendee.id}: ${msg}`);
                }
            }
        } catch (lookupErr: unknown) {
            const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
            logger.warn(`Failed attendee lookup during meeting update for event ${updated.id}: ${msg}`);
        }
    }

    if (datesOrReminderChanged) {
        if (updated.hasReminder) {
            await scheduleEventReminder(updated);
        } else {
            await cancelEventReminder(updated.id);
        }
    }

    return updated;
};

export const deleteCalendarEvent = async (userId: string, eventId: string) => {
    const existing = await prisma.calendarEvent.findFirst({
        where: { id: eventId, userId },
    });

    if (!existing) {
        throw new ApiError(404, 'Calendar event not found');
    }

    await cancelEventReminder(eventId);

    return await prisma.calendarEvent.delete({
        where: { id: existing.id },
    });
};
