import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { getIO } from '../sockets/socketServer.js';
import logger from '../utils/logger.js';
import type { CreateEventInput, UpdateEventInput } from '../types/index.js';

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

  if (end < start) {
    throw new ApiError(400, 'End date cannot be earlier than start date');
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
            body: `${creator.name} scheduled a meeting for ${start.toLocaleDateString()} at ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
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
        } catch {
        }
      } catch (err: any) {
        logger.warn(`Could not dispatch meeting notification: ${err.message}`);
      }
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
          body: `Scheduled for ${start.toLocaleDateString()} at ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          data: {
            eventId: event.id,
            startDate: start.toISOString(),
          },
        },
      });

      try {
        const io = getIO();
        io.to(`user:${userId}`).emit('notification:new', reminderNotif);
      } catch {
      }
    } catch (err: any) {
      logger.warn(`Could not create reminder confirmation: ${err.message}`);
    }
  }

  return event;
};

export const getCalendarEventsByMonth = async (userId: string, year: number, month: number) => {
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  return await prisma.calendarEvent.findMany({
    where: {
      userId,
      startDate: {
        gte: startOfMonth,
        lt: endOfMonth,
      },
    },
    orderBy: { startDate: 'asc' },
  });
};

export const getCalendarEventsByDate = async (userId: string, dateStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  return await prisma.calendarEvent.findMany({
    where: {
      userId,
      startDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
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
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
  });

  if (!event || event.userId !== userId) {
    throw new ApiError(404, 'Calendar event not found');
  }

  return event;
};

export const updateCalendarEvent = async (userId: string, eventId: string, input: UpdateEventInput) => {
  const existing = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
  });

  if (!existing || existing.userId !== userId) {
    throw new ApiError(404, 'Calendar event not found');
  }

  return await prisma.calendarEvent.update({
    where: { id: eventId },
    data: {
      ...(input.title && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.eventType && { eventType: input.eventType }),
      ...(input.startDate && { startDate: new Date(input.startDate) }),
      ...(input.endDate && { endDate: new Date(input.endDate) }),
      ...(input.isAllDay !== undefined && { isAllDay: input.isAllDay }),
      ...(input.meetingLink !== undefined && { meetingLink: input.meetingLink }),
      ...(input.attendeeEmails && { attendeeEmails: input.attendeeEmails }),
      ...(input.hasReminder !== undefined && { hasReminder: input.hasReminder }),
      ...(input.reminderMinutes !== undefined && { reminderMinutes: input.reminderMinutes }),
    },
  });
};

export const deleteCalendarEvent = async (userId: string, eventId: string) => {
  const existing = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
  });

  if (!existing || existing.userId !== userId) {
    throw new ApiError(404, 'Calendar event not found');
  }

  return await prisma.calendarEvent.delete({
    where: { id: eventId },
  });
};
