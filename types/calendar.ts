export type CalendarEventType = 'REMINDER' | 'MEETING' | 'DEADLINE' | 'GENERAL';

export interface CreateEventInput {
  title: string;
  description?: string;
  eventType?: CalendarEventType;
  startDate: string;
  endDate?: string;
  isAllDay?: boolean;
  meetingLink?: string;
  attendeeEmails?: string[];
  hasReminder?: boolean;
  reminderMinutes?: number;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  eventType?: CalendarEventType;
  startDate?: string;
  endDate?: string;
  isAllDay?: boolean;
  meetingLink?: string;
  attendeeEmails?: string[];
  hasReminder?: boolean;
  reminderMinutes?: number;
}
