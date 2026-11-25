import { providerApi, clip } from "./http";
import { MICROSOFT_SCOPES, hasScope } from "./providers";
import { grantedScopes } from "./store";
import { IntegrationScopeError } from "./errors";
import { utcWallClock } from "./time";
import type { CalendarEvent, CreateEventInput, EmailSummary, SendEmailInput, SentEmail } from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0/me";

async function requireScope(workspaceId: string, scope: string, what: string) {
  const scopes = await grantedScopes(workspaceId, "microsoft");
  if (!hasScope(scopes, scope)) throw new IntegrationScopeError("microsoft", what);
}

const recipients = (list: string[] | undefined) => (list ?? []).map((address) => ({ emailAddress: { address } }));

export async function outlookSend(workspaceId: string, i: SendEmailInput): Promise<SentEmail> {
  await requireScope(workspaceId, MICROSOFT_SCOPES.mailSend, "send email");
  await providerApi(workspaceId, "microsoft", `${GRAPH}/sendMail`, {
    method: "POST",
    service: "Outlook",
    timeoutMs: 30_000,
    json: {
      message: {
        subject: i.subject,
        body: { contentType: "Text", content: i.body },
        toRecipients: recipients(i.to),
        ccRecipients: recipients(i.cc),
        bccRecipients: recipients(i.bcc),
        // Custom x- header makes the send traceable to the approved Nexus action.
        ...(i.idempotencyKey ? { internetMessageHeaders: [{ name: "x-nexus-action-id", value: i.idempotencyKey.slice(0, 64) }] } : {}),
      },
      saveToSentItems: true,
    },
  });
  // Graph's sendMail returns 202 with no body (no message id).
  return { provider: "microsoft", id: null, deduplicated: false };
}

interface GraphMessage {
  id: string; conversationId?: string; subject?: string; bodyPreview?: string; receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
}

const fmtAddr = (a?: { name?: string; address?: string }) => (a ? (a.name && a.address ? `${a.name} <${a.address}>` : a.address ?? a.name ?? "") : "");

export async function outlookSearch(workspaceId: string, q: string | undefined, max: number): Promise<EmailSummary[]> {
  await requireScope(workspaceId, MICROSOFT_SCOPES.mailRead, "read email");
  const p = new URLSearchParams({ $top: String(max), $select: "id,conversationId,subject,bodyPreview,receivedDateTime,from,toRecipients" });
  // $search cannot be combined with $orderby; results are relevance/recency ranked by Exchange.
  if (q) p.set("$search", `"${q.replace(/["\\]/g, " ")}"`);
  else p.set("$orderby", "receivedDateTime desc");
  const r = await providerApi<{ value?: GraphMessage[] }>(workspaceId, "microsoft", `${GRAPH}/messages?${p}`, { service: "Outlook" });
  return (r.data?.value ?? []).slice(0, max).map((m) => ({
    id: m.id,
    threadId: m.conversationId ?? null,
    from: clip(fmtAddr(m.from?.emailAddress), 200),
    to: clip((m.toRecipients ?? []).map((x) => fmtAddr(x.emailAddress)).join(", "), 300),
    subject: clip(m.subject ?? "", 300),
    date: m.receivedDateTime ?? "",
    snippet: clip(m.bodyPreview ?? "", 400),
  }));
}

interface GraphEvent {
  id: string; subject?: string; bodyPreview?: string; webLink?: string; isAllDay?: boolean; isCancelled?: boolean;
  start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string }; organizer?: { emailAddress?: { address?: string } };
  attendees?: Array<{ emailAddress?: { address?: string }; status?: { response?: string } }>;
  onlineMeeting?: { joinUrl?: string } | null;
}

/** Graph returns wall-clock times in the zone requested via Prefer: outlook.timezone="UTC". */
const asUtcIso = (dt?: { dateTime?: string; timeZone?: string }) => (dt?.dateTime ? (dt.timeZone === "UTC" && !/Z$/.test(dt.dateTime) ? `${dt.dateTime.replace(/\.\d+$/, "")}Z` : dt.dateTime) : null);

function mapEvent(e: GraphEvent): CalendarEvent {
  return {
    id: e.id,
    title: clip(e.subject ?? "(no title)", 300),
    start: asUtcIso(e.start),
    end: asUtcIso(e.end),
    allDay: Boolean(e.isAllDay),
    location: e.location?.displayName ? clip(e.location.displayName, 200) : null,
    organizer: e.organizer?.emailAddress?.address ?? null,
    attendees: (e.attendees ?? []).slice(0, 30).map((a) => ({ email: a.emailAddress?.address ?? "", response: a.status?.response ?? null })),
    description: e.bodyPreview ? clip(e.bodyPreview, 600) : null,
    link: e.webLink ?? null,
    meetingLink: e.onlineMeeting?.joinUrl ?? null,
  };
}

export async function outlookListEvents(workspaceId: string, from: Date, to: Date, max: number): Promise<CalendarEvent[]> {
  await requireScope(workspaceId, MICROSOFT_SCOPES.calendarsReadWrite, "access the calendar");
  const p = new URLSearchParams({
    startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: String(max), $orderby: "start/dateTime",
    $select: "id,subject,bodyPreview,webLink,isAllDay,isCancelled,start,end,location,organizer,attendees,onlineMeeting",
  });
  const r = await providerApi<{ value?: GraphEvent[] }>(workspaceId, "microsoft", `${GRAPH}/calendarView?${p}`, {
    service: "Outlook Calendar", headers: { Prefer: 'outlook.timezone="UTC"' },
  });
  return (r.data?.value ?? []).filter((e) => !e.isCancelled).map(mapEvent);
}

export async function outlookCreateEvent(workspaceId: string, i: CreateEventInput): Promise<CalendarEvent> {
  await requireScope(workspaceId, MICROSOFT_SCOPES.calendarsReadWrite, "create calendar events");
  const r = await providerApi<GraphEvent>(workspaceId, "microsoft", `${GRAPH}/events`, {
    method: "POST",
    service: "Outlook Calendar",
    headers: { Prefer: 'outlook.timezone="UTC"' },
    json: {
      subject: i.title,
      body: i.description ? { contentType: "text", content: i.description } : undefined,
      start: { dateTime: utcWallClock(i.start), timeZone: "UTC" },
      end: { dateTime: utcWallClock(i.end), timeZone: "UTC" },
      location: i.location ? { displayName: i.location } : undefined,
      attendees: i.attendees.map((address) => ({ emailAddress: { address }, type: "required" })),
      // Graph de-duplicates creates that carry the same transactionId.
      ...(i.idempotencyKey ? { transactionId: i.idempotencyKey.slice(0, 64) } : {}),
    },
  });
  return mapEvent(r.data);
}
