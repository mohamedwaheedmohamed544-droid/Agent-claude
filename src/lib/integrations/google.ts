import { providerApi, clip } from "./http";
import { buildPlainTextMime, decodeHeaderWords, toBase64Url } from "./mime";
import { GOOGLE_SCOPES, hasScope } from "./providers";
import { grantedScopes } from "./store";
import { IntegrationScopeError } from "./errors";
import type { CalendarEvent, CreateEventInput, EmailSummary, SendEmailInput, SentEmail } from "./types";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

async function requireScope(workspaceId: string, scope: string, what: string) {
  const scopes = await grantedScopes(workspaceId, "google");
  if (!hasScope(scopes, scope)) throw new IntegrationScopeError("google", what);
}

// ─────────────── Gmail ───────────────

interface GmailMessageMeta {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

function header(m: GmailMessageMeta, name: string): string {
  const h = m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? decodeHeaderWords(h.value) : "";
}

export async function gmailSend(workspaceId: string, i: SendEmailInput): Promise<SentEmail> {
  await requireScope(workspaceId, GOOGLE_SCOPES.gmailSend, "send email");
  // A deterministic Message-ID lets us detect a send that succeeded at Gmail but was not recorded locally.
  const messageId = i.idempotencyKey ? `<nexus-${i.idempotencyKey.slice(0, 48)}@nexus-ai.mail>` : undefined;
  if (messageId) {
    const prior = await providerApi<{ messages?: Array<{ id: string; threadId: string }> }>(
      workspaceId, "google", `${GMAIL}/messages?maxResults=1&includeSpamTrash=false&q=${encodeURIComponent(`in:sent rfc822msgid:${messageId}`)}`,
      { service: "Gmail" },
    );
    const hit = prior.data?.messages?.[0];
    if (hit) return { provider: "google", id: hit.id, threadId: hit.threadId, deduplicated: true };
  }
  const raw = toBase64Url(buildPlainTextMime({ to: i.to, cc: i.cc, bcc: i.bcc, subject: i.subject, body: i.body, messageId }));
  const r = await providerApi<{ id: string; threadId: string }>(workspaceId, "google", `${GMAIL}/messages/send`, {
    method: "POST", json: { raw }, service: "Gmail", timeoutMs: 30_000,
  });
  return { provider: "google", id: r.data.id, threadId: r.data.threadId, deduplicated: false };
}

export async function gmailSearch(workspaceId: string, q: string | undefined, max: number): Promise<EmailSummary[]> {
  await requireScope(workspaceId, GOOGLE_SCOPES.gmailRead, "read email");
  const params = new URLSearchParams({ maxResults: String(max) });
  if (q) params.set("q", q);
  const list = await providerApi<{ messages?: Array<{ id: string }> }>(workspaceId, "google", `${GMAIL}/messages?${params}`, { service: "Gmail" });
  const ids = (list.data?.messages ?? []).slice(0, max).map((m) => m.id);
  const out: EmailSummary[] = [];
  // Bounded concurrency keeps us well inside Gmail's per-user rate limits.
  for (let k = 0; k < ids.length; k += 5) {
    const batch = await Promise.all(ids.slice(k, k + 5).map((id) =>
      providerApi<GmailMessageMeta>(workspaceId, "google",
        `${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`,
        { service: "Gmail" })));
    for (const { data: m } of batch) {
      out.push({
        id: m.id,
        threadId: m.threadId ?? null,
        from: clip(header(m, "From"), 200),
        to: clip(header(m, "To"), 300),
        subject: clip(header(m, "Subject"), 300),
        date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(m, "Date"),
        snippet: clip(m.snippet ?? "", 400),
      });
    }
  }
  return out;
}

// ─────────────── Calendar ───────────────

interface GEvent {
  id: string; status?: string; summary?: string; description?: string; location?: string; htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string }; attendees?: Array<{ email?: string; responseStatus?: string }>; hangoutLink?: string;
}

function mapGEvent(e: GEvent): CalendarEvent {
  return {
    id: e.id,
    title: clip(e.summary ?? "(no title)", 300),
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    allDay: Boolean(e.start?.date && !e.start?.dateTime),
    location: e.location ? clip(e.location, 200) : null,
    organizer: e.organizer?.email ?? null,
    attendees: (e.attendees ?? []).slice(0, 30).map((a) => ({ email: a.email ?? "", response: a.responseStatus ?? null })),
    description: e.description ? clip(e.description, 600) : null,
    link: e.htmlLink ?? null,
    meetingLink: e.hangoutLink ?? null,
  };
}

export async function googleListEvents(workspaceId: string, from: Date, to: Date, max: number): Promise<CalendarEvent[]> {
  await requireScope(workspaceId, GOOGLE_SCOPES.calendarEvents, "access the calendar");
  const p = new URLSearchParams({
    timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: String(max),
  });
  const r = await providerApi<{ items?: GEvent[] }>(workspaceId, "google", `${CAL}/events?${p}`, { service: "Google Calendar" });
  return (r.data?.items ?? []).filter((e) => e.status !== "cancelled").map(mapGEvent);
}

export async function googleCreateEvent(workspaceId: string, i: CreateEventInput): Promise<CalendarEvent> {
  await requireScope(workspaceId, GOOGLE_SCOPES.calendarEvents, "create calendar events");
  const sendUpdates = i.attendees.length ? "all" : "none";
  // Google lets clients choose the event id (base32hex: 0-9a-v). A hex idempotency key is valid, so a retry
  // of the same approved action cannot create a duplicate event — Google answers 409 instead.
  const id = i.idempotencyKey ? i.idempotencyKey.toLowerCase().replace(/[^0-9a-v]/g, "").slice(0, 64) : undefined;
  const body = {
    ...(id && id.length >= 5 ? { id } : {}),
    summary: i.title,
    description: i.description,
    location: i.location,
    start: { dateTime: i.start.toISOString(), ...(i.timeZone ? { timeZone: i.timeZone } : {}) },
    end: { dateTime: i.end.toISOString(), ...(i.timeZone ? { timeZone: i.timeZone } : {}) },
    attendees: i.attendees.length ? i.attendees.map((email) => ({ email })) : undefined,
  };
  const r = await providerApi<GEvent>(workspaceId, "google", `${CAL}/events?sendUpdates=${sendUpdates}`, {
    method: "POST", json: body, service: "Google Calendar", allowStatus: [409],
  });
  if (r.status === 409 && body.id) {
    const existing = await providerApi<GEvent>(workspaceId, "google", `${CAL}/events/${encodeURIComponent(body.id)}`, { service: "Google Calendar" });
    return { ...mapGEvent(existing.data), deduplicated: true };
  }
  return mapGEvent(r.data);
}

// ─────────────── Drive ───────────────

export interface DriveFile {
  id: string; name: string; mimeType: string; modifiedTime: string | null; size: number | null; link: string | null; owner: string | null;
}

interface GDriveFile {
  id: string; name?: string; mimeType?: string; modifiedTime?: string; size?: string; webViewLink?: string; owners?: Array<{ displayName?: string }>;
}

function mapDrive(f: GDriveFile): DriveFile {
  return {
    id: f.id, name: clip(f.name ?? "", 300), mimeType: f.mimeType ?? "", modifiedTime: f.modifiedTime ?? null,
    size: f.size ? Number(f.size) : null, link: f.webViewLink ?? null, owner: f.owners?.[0]?.displayName ?? null,
  };
}

/** Escapes a value for a Drive query string literal. */
export function driveQueryLiteral(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export async function driveSearch(workspaceId: string, text: string | undefined, max: number, mimeType?: string): Promise<DriveFile[]> {
  const scopes = await grantedScopes(workspaceId, "google");
  if (!hasScope(scopes, GOOGLE_SCOPES.driveMetadataRead) && !hasScope(scopes, GOOGLE_SCOPES.driveFile)) {
    throw new IntegrationScopeError("google", "search Google Drive");
  }
  const clauses = ["trashed = false"];
  if (text) clauses.push(`(name contains ${driveQueryLiteral(text)} or fullText contains ${driveQueryLiteral(text)})`);
  if (mimeType) clauses.push(`mimeType = ${driveQueryLiteral(mimeType)}`);
  const p = new URLSearchParams({
    q: clauses.join(" and "), pageSize: String(max), orderBy: text ? "" : "modifiedTime desc",
    fields: "files(id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName))",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true", spaces: "drive",
  });
  if (!p.get("orderBy")) p.delete("orderBy"); // orderBy is not supported together with fullText search
  const r = await providerApi<{ files?: GDriveFile[] }>(workspaceId, "google", `${DRIVE}/files?${p}`, { service: "Google Drive" });
  return (r.data?.files ?? []).map(mapDrive);
}

export async function driveUpload(workspaceId: string, f: {
  name: string; mimeType: string; content: Buffer; folderId?: string; convert?: boolean; idempotencyKey?: string;
}): Promise<DriveFile & { deduplicated: boolean }> {
  await requireScope(workspaceId, GOOGLE_SCOPES.driveFile, "upload files to Google Drive");
  const fields = "id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName)";
  const idem = f.idempotencyKey?.replace(/[^0-9a-f]/gi, "").slice(0, 64);
  if (idem) {
    // Files created by this app are visible under drive.file, so we can detect a previous successful upload.
    const q = `appProperties has { key='nexus_idem' and value=${driveQueryLiteral(idem)} } and trashed = false`;
    const prior = await providerApi<{ files?: GDriveFile[] }>(workspaceId, "google",
      `${DRIVE}/files?${new URLSearchParams({ q, pageSize: "1", fields: `files(${fields})` })}`, { service: "Google Drive" });
    const hit = prior.data?.files?.[0];
    if (hit) return { ...mapDrive(hit), deduplicated: true };
  }
  const CONVERT: Record<string, string> = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "application/vnd.google-apps.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "application/vnd.google-apps.spreadsheet",
    "text/markdown": "application/vnd.google-apps.document",
    "text/plain": "application/vnd.google-apps.document",
  };
  const metadata: Record<string, unknown> = { name: f.name };
  if (f.folderId) metadata.parents = [f.folderId];
  if (f.convert && CONVERT[f.mimeType]) metadata.mimeType = CONVERT[f.mimeType];
  if (idem) metadata.appProperties = { nexus_idem: idem };
  const boundary = `nexus_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${f.mimeType}\r\n\r\n`),
    f.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await providerApi<GDriveFile>(workspaceId, "google",
    `${DRIVE_UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(fields)}`, {
      method: "POST", body: new Uint8Array(body), contentType: `multipart/related; boundary=${boundary}`, service: "Google Drive", timeoutMs: 60_000,
    });
  return { ...mapDrive(r.data), deduplicated: false };
}
