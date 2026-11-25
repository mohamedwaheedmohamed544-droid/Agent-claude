/**
 * Minimal, standards-compliant MIME builder for plain-text UTF-8 email (RFC 5322 / 2045 / 2047).
 * Used for the Gmail API `raw` field. Handles Arabic and any other non-ASCII text.
 */

const CRLF = "\r\n";

/** Removes characters that could break out of a header (CR/LF/NUL). */
export function sanitizeHeaderValue(v: string): string {
  return v.replace(/[\r\n\0]+/g, " ").trim();
}

/** RFC 2047 "B" encoding, split into encoded-words of ≤75 chars without splitting UTF-8 sequences. */
export function encodeHeaderWord(value: string): string {
  const clean = sanitizeHeaderValue(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const ch of clean) {
    const n = Buffer.byteLength(ch, "utf8");
    // 45 bytes → 60 base64 chars + 12 for "=?UTF-8?B?" and "?=" = 72 ≤ 75
    if (chunkBytes + n > 45) { words.push(chunk); chunk = ""; chunkBytes = 0; }
    chunk += ch;
    chunkBytes += n;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join(`${CRLF} `);
}

/** Decodes RFC 2047 encoded words (B and Q). Exported for tests and for reading message headers. */
export function decodeHeaderWords(value: string): string {
  return value.replace(/\r\n\s+/g, " ").replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1").replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _cs, enc: string, data: string) => {
    if (enc.toUpperCase() === "B") return Buffer.from(data, "base64").toString("utf8");
    const bytes = data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  });
}

function wrapBase64(b64: string): string {
  return b64.replace(/.{1,76}/g, (l) => l + CRLF).replace(/\r\n$/, "");
}

/** Converts simple Markdown to readable plain text (headings, emphasis, links, list bullets). */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface PlainEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  messageId?: string;
  date?: Date;
}

function addressList(list: string[]): string {
  return list.map(sanitizeHeaderValue).join(", ");
}

/** Builds an RFC 5322 message with a base64 UTF-8 text/plain body. */
export function buildPlainTextMime(m: PlainEmail): string {
  const headers: string[] = [];
  headers.push(`To: ${addressList(m.to)}`);
  if (m.cc?.length) headers.push(`Cc: ${addressList(m.cc)}`);
  if (m.bcc?.length) headers.push(`Bcc: ${addressList(m.bcc)}`);
  headers.push(`Subject: ${encodeHeaderWord(m.subject)}`);
  if (m.messageId) headers.push(`Message-ID: ${sanitizeHeaderValue(m.messageId)}`);
  headers.push(`Date: ${(m.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: base64");
  const body = m.body.replace(/\r?\n/g, CRLF);
  return `${headers.join(CRLF)}${CRLF}${CRLF}${wrapBase64(Buffer.from(body, "utf8").toString("base64"))}${CRLF}`;
}

export function toBase64Url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64url");
}
