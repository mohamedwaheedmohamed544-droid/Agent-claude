import type { OAuthProviderId } from "./providers";

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Plain text (already converted from Markdown). */
  body: string;
  idempotencyKey?: string;
}

export interface SentEmail {
  provider: OAuthProviderId;
  id: string | null;
  threadId?: string | null;
  deduplicated: boolean;
}

export interface EmailSummary {
  id: string;
  threadId: string | null;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  organizer: string | null;
  attendees: Array<{ email: string; response: string | null }>;
  description: string | null;
  link: string | null;
  meetingLink: string | null;
  deduplicated?: boolean;
}

export interface CreateEventInput {
  title: string;
  start: Date;
  end: Date;
  timeZone?: string;
  attendees: string[];
  description?: string;
  location?: string;
  idempotencyKey?: string;
}
