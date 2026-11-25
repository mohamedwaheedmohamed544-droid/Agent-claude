import JSZip from "jszip";
import { AppError } from "../errors";

/**
 * Upload validation: extension allow-list, magic-byte verification, container sanity checks
 * and filename sanitisation. Nothing about the client-declared MIME type is trusted.
 */

export type FileKind = "pdf" | "docx" | "xlsx" | "pptx" | "csv" | "txt" | "md" | "json";

export const KIND_MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
};

const EXTENSION_KIND: Record<string, FileKind> = {
  pdf: "pdf", docx: "docx", xlsx: "xlsx", pptx: "pptx", csv: "csv", txt: "txt", text: "txt", md: "md", markdown: "md", json: "json",
};

export const ALLOWED_EXTENSIONS = Object.keys(EXTENSION_KIND);

/** Main part each OOXML container must contain to be accepted as that type. */
const OOXML_MAIN_PART: Record<"docx" | "xlsx" | "pptx", string> = {
  docx: "word/document.xml",
  xlsx: "xl/workbook.xml",
  pptx: "ppt/presentation.xml",
};

/** Absolute ceiling regardless of configuration. */
export const HARD_MAX_UPLOAD_MB = 15;
const DEFAULT_MAX_UPLOAD_MB = 4;
/** Zip-bomb guard: total declared uncompressed size of an OOXML container. */
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;

/**
 * Effective per-file limit in bytes. Defaults to 4 MB because Vercel serverless functions reject
 * request bodies above ~4.5 MB before they reach the handler; self-hosted deployments may raise
 * NEXUS_MAX_UPLOAD_MB up to the 15 MB hard cap.
 */
export function maxUploadBytes(): number {
  const raw = Number(process.env.NEXUS_MAX_UPLOAD_MB);
  const mb = Number.isFinite(raw) && raw > 0 ? Math.min(raw, HARD_MAX_UPLOAD_MB) : DEFAULT_MAX_UPLOAD_MB;
  return Math.floor(mb * 1024 * 1024);
}

export class UploadRejected extends AppError {
  constructor(message: string, code = "invalid_file", status = 400) {
    super(status, code, message);
  }
}

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(filename.trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * Produces a display/storage-safe filename: strips directories, control and bidi-override
 * characters (which can disguise extensions), reserved characters, and limits length while
 * keeping the extension. Unicode letters (e.g. Arabic) are preserved.
 */
export function sanitizeFilename(input: string): string {
  let name = (input ?? "").normalize("NFC");
  name = name.split(/[\\/]/).pop() ?? "";
  name = name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  // A bare ".pdf" would otherwise lose its extension when leading dots are stripped.
  if (/^\.+[A-Za-z0-9]{1,10}$/.test(name)) name = `file${name.replace(/^\.+/, ".")}`;
  name = name
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  const ext = extensionOf(name);
  if (!name || name === `.${ext}` || name.toLowerCase() === ext) name = ext ? `file.${ext}` : "file";
  const max = 180;
  if (name.length > max) {
    const suffix = ext ? `.${ext}` : "";
    name = name.slice(0, max - suffix.length).trimEnd() + suffix;
  }
  return name;
}

function startsWith(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  return sig.every((b, i) => buf[offset + i] === b);
}

const EXECUTABLE_SIGNATURES: number[][] = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xcf, 0xfa, 0xed, 0xfe], [0xce, 0xfa, 0xed, 0xfe], [0xfe, 0xed, 0xfa, 0xcf], [0xfe, 0xed, 0xfa, 0xce], // Mach-O
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O fat / Java class
  [0x00, 0x61, 0x73, 0x6d], // WebAssembly
];

function looksExecutable(buf: Buffer): boolean {
  // "MZ" alone could start a plain-text file; a real PE/DOS header has NUL bytes right after it.
  if (startsWith(buf, [0x4d, 0x5a]) && buf.subarray(2, 64).includes(0x00)) return true;
  return EXECUTABLE_SIGNATURES.some((sig) => startsWith(buf, sig));
}

/** Markup that a browser could render as an active document. */
function looksLikeActiveMarkup(text: string): boolean {
  const head = text.slice(0, 2048).replace(/^\ufeff/, "").trimStart().toLowerCase();
  return /^(<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]|<svg[\s>]|<\?xml[^>]*>\s*(<!doctype\s+svg|<svg))/.test(head);
}

/** Decodes a text upload, accepting UTF-8 (with/without BOM) and BOM-marked UTF-16. */
export function decodeText(buf: Buffer): string {
  if (startsWith(buf, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (startsWith(buf, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  const body = startsWith(buf, [0xef, 0xbb, 0xbf]) ? buf.subarray(3) : buf;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new UploadRejected("Text files must be UTF-8 encoded.");
  }
}

function hasBinaryContent(buf: Buffer): boolean {
  const isUtf16 = startsWith(buf, [0xff, 0xfe]) || startsWith(buf, [0xfe, 0xff]);
  if (isUtf16) return false;
  const sample = buf.subarray(0, 8192);
  return sample.includes(0x00);
}

interface ZipEntryInternals { _data?: { uncompressedSize?: number } }

/** Opens an OOXML container and checks it is the expected document type and not a zip bomb. */
async function verifyOoxml(buf: Buffer, kind: "docx" | "xlsx" | "pptx"): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new UploadRejected("The file is not a valid Office document (corrupted archive).");
  }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) throw new UploadRejected("The document contains too many embedded parts.");
  let total = 0;
  for (const e of entries) total += (e as unknown as ZipEntryInternals)._data?.uncompressedSize ?? 0;
  if (total > MAX_UNCOMPRESSED_BYTES) throw new UploadRejected("The document expands to an unsafe size and was rejected.");
  if (!zip.file("[Content_Types].xml") || !zip.file(OOXML_MAIN_PART[kind])) {
    throw new UploadRejected(`The file content does not match the .${kind} extension.`);
  }
  if (kind === "docx" && zip.file("word/vbaProject.bin")) throw new UploadRejected("Macro-enabled documents are not accepted.");
  if (kind === "xlsx" && zip.file("xl/vbaProject.bin")) throw new UploadRejected("Macro-enabled workbooks are not accepted.");
  if (kind === "pptx" && zip.file("ppt/vbaProject.bin")) throw new UploadRejected("Macro-enabled presentations are not accepted.");
}

export interface ValidatedUpload {
  filename: string;
  kind: FileKind;
  mimeType: string;
}

/**
 * Validates an uploaded file. Throws UploadRejected (400/413) with a user-safe message.
 * Order: size → extension allow-list → executable sniff → per-type magic bytes / structure.
 */
export async function validateUpload(rawName: string, buf: Buffer): Promise<ValidatedUpload> {
  const max = maxUploadBytes();
  if (buf.length === 0) throw new UploadRejected("The file is empty.");
  if (buf.length > max) {
    throw new UploadRejected(`The file exceeds the ${Math.round((max / 1024 / 1024) * 10) / 10} MB upload limit.`, "payload_too_large", 413);
  }
  const filename = sanitizeFilename(rawName);
  const ext = extensionOf(filename);
  const kind = EXTENSION_KIND[ext];
  if (!kind) {
    throw new UploadRejected(`Unsupported file type${ext ? ` ".${ext}"` : ""}. Allowed: PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, JSON.`, "unsupported_type", 415);
  }
  if (looksExecutable(buf)) throw new UploadRejected("Executable content is not allowed.");

  switch (kind) {
    case "pdf": {
      // The PDF header must appear within the first 1024 bytes (per the spec's tolerance).
      const head = buf.subarray(0, 1024).toString("latin1");
      if (!head.includes("%PDF-")) throw new UploadRejected("The file content does not match the .pdf extension.");
      break;
    }
    case "docx":
    case "xlsx":
    case "pptx":
      if (!startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) throw new UploadRejected(`The file content does not match the .${kind} extension.`);
      await verifyOoxml(buf, kind);
      break;
    default: {
      if (startsWith(buf, [0x25, 0x50, 0x44, 0x46]) || startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
        throw new UploadRejected(`The file content does not match the .${ext} extension.`);
      }
      if (hasBinaryContent(buf)) throw new UploadRejected("Binary content is not allowed in a text file.");
      const text = decodeText(buf);
      if (looksLikeActiveMarkup(text)) throw new UploadRejected("HTML and SVG documents are not accepted.");
      if (kind === "json") {
        try { JSON.parse(text.replace(/^\ufeff/, "")); } catch { throw new UploadRejected("The file is not valid JSON."); }
      }
    }
  }
  return { filename, kind, mimeType: KIND_MIME[kind] };
}

/** Maps a stored file back to its kind (used for reprocessing and downloads). */
export function kindOf(filename: string, mimeType: string): FileKind | null {
  const byExt = EXTENSION_KIND[extensionOf(filename)];
  if (byExt) return byExt;
  const entry = (Object.entries(KIND_MIME) as Array<[FileKind, string]>).find(([, m]) => m === mimeType);
  return entry?.[0] ?? null;
}
