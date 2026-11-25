import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import { decodeText, type FileKind } from "./validation";

/**
 * Text extraction for every supported document type. Output is a list of sections that carry
 * location metadata (page / sheet / slide) so chunks can cite where they came from.
 * Extracted text is untrusted data: it is stored and indexed, never interpreted.
 */

export interface SectionMeta {
  page?: number;
  sheet?: string;
  slide?: number;
}

export interface Section {
  text: string;
  meta: SectionMeta;
  /** Context repeated at the top of every chunk cut from this section (e.g. a sheet's header row). */
  prefix?: string;
}

export interface ParsedDocument {
  text: string;
  sections: Section[];
  truncated: boolean;
}

/** Cap on extracted characters per document; keeps chunk/embedding volume bounded. */
export const MAX_EXTRACTED_CHARS = 2_000_000;
const MAX_SHEET_ROWS = 20_000;
const MAX_SHEET_COLS = 60;

export class ParseError extends Error {}

/** Normalises whitespace and strips characters Postgres text cannot hold (NUL) or that are invisible noise. */
export function normalizeText(input: string): string {
  return input
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseDocument(kind: FileKind, buf: Buffer): Promise<ParsedDocument> {
  let sections: Section[];
  switch (kind) {
    case "pdf": sections = await parsePdf(buf); break;
    case "docx": sections = await parseDocx(buf); break;
    case "xlsx": sections = await parseXlsx(buf); break;
    case "pptx": sections = await parsePptx(buf); break;
    case "csv": sections = parseCsvDocument(decodeText(buf)); break;
    case "json": sections = parseJson(decodeText(buf)); break;
    case "txt":
    case "md": sections = [{ text: decodeText(buf), meta: {} }]; break;
  }
  return finalize(sections);
}

function finalize(raw: Section[]): ParsedDocument {
  const sections: Section[] = [];
  let budget = MAX_EXTRACTED_CHARS;
  let truncated = false;
  for (const s of raw) {
    let text = normalizeText(s.text);
    if (!text) continue;
    if (text.length > budget) { text = text.slice(0, budget); truncated = true; }
    budget -= text.length;
    sections.push({ ...s, text });
    if (budget <= 0) { truncated = truncated || sections.length < raw.length; break; }
  }
  return { text: sections.map(renderSection).join("\n\n"), sections, truncated };
}

function renderSection(s: Section): string {
  if (s.meta.slide !== undefined) return s.text; // already prefixed with "Slide N"
  if (s.meta.sheet !== undefined) return s.text; // already prefixed with the sheet heading
  if (s.meta.page !== undefined) return `[Page ${s.meta.page}]\n${s.text}`;
  return s.text;
}

// ───────────── PDF ─────────────

async function parsePdf(buf: Buffer): Promise<Section[]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pdf;
  try {
    // Copy into a fresh Uint8Array: pdf.js may transfer/detach the underlying buffer.
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    if (name === "PasswordException") throw new ParseError("This PDF is password-protected. Remove the password and upload it again.");
    throw new ParseError("The PDF could not be read. It may be corrupted.");
  }
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((t, i) => ({ text: t, meta: { page: i + 1 } }));
  } finally {
    await (pdf as { destroy?: () => Promise<void> }).destroy?.().catch(() => {});
  }
}

// ───────────── DOCX ─────────────

async function parseDocx(buf: Buffer): Promise<Section[]> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return [{ text: value, meta: {} }];
  } catch {
    throw new ParseError("The Word document could not be read. It may be corrupted.");
  }
}

// ───────────── XLSX ─────────────

function escapeCell(s: string): string {
  return s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/** Renders an ExcelJS cell value as display text. */
export function cellToText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, v.getUTCHours() || v.getUTCMinutes() ? 16 : 10).replace("T", " ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    if ("result" in o) return cellToText(o.result);
    if ("text" in o) return cellToText(o.text);
    if ("error" in o) return String(o.error ?? "");
    if ("sharedFormula" in o || "formula" in o) return "";
    return "";
  }
  return String(v);
}

function renderTable(rows: string[][]): string[] {
  const width = Math.min(MAX_SHEET_COLS, Math.max(...rows.map((r) => r.length)));
  const lines: string[] = [];
  rows.forEach((r, i) => {
    const cells = Array.from({ length: width }, (_, c) => escapeCell(r[c] ?? ""));
    lines.push(`| ${cells.join(" | ")} |`);
    if (i === 0 && rows.length > 1) lines.push(`|${" --- |".repeat(width)}`);
  });
  return lines;
}

async function parseXlsx(buf: Buffer): Promise<Section[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new ParseError("The spreadsheet could not be read. It may be corrupted or password-protected.");
  }
  const sections: Section[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state === "veryHidden") continue;
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= MAX_SHEET_ROWS) return;
      const values = (row.values as unknown[]).slice(1).map(cellToText);
      while (values.length && !values[values.length - 1]) values.pop();
      if (values.some((v) => v.trim())) rows.push(values);
    });
    if (!rows.length) continue;
    const lines = renderTable(rows);
    const heading = `## Sheet: ${ws.name}`;
    const header = rows.length > 1 ? `\n${lines[0]}\n${lines[1]}` : "";
    sections.push({
      text: `${heading}\n\n${lines.join("\n")}`,
      meta: { sheet: ws.name },
      prefix: `${heading}${header}`,
    });
  }
  return sections;
}

// ───────────── PPTX ─────────────

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Extracts <a:t> runs from DrawingML, one output line per <a:p> paragraph. */
export function drawingMlText(xml: string): string {
  const paragraphs = xml.split(/<\/a:p>/);
  const lines: string[] = [];
  for (const p of paragraphs) {
    const runs = [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const line = runs.join("").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

async function parsePptx(buf: Buffer): Promise<Section[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new ParseError("The presentation could not be read. It may be corrupted.");
  }
  const slides = Object.keys(zip.files)
    .map((name) => ({ name, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1]) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);
  const sections: Section[] = [];
  for (const s of slides) {
    const body = drawingMlText(await zip.file(s.name)!.async("string"));
    const notes = await slideNotes(zip, s.n);
    const parts = [`Slide ${s.n}`];
    if (body) parts.push(body);
    if (notes) parts.push(`Notes:\n${notes}`);
    if (parts.length > 1) sections.push({ text: parts.join("\n"), meta: { slide: s.n } });
  }
  return sections;
}

/** Speaker notes are linked from the slide's relationships file, not by matching numbers. */
async function slideNotes(zip: JSZip, n: number): Promise<string> {
  const rels = zip.file(`ppt/slides/_rels/slide${n}.xml.rels`);
  if (!rels) return "";
  const target = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(await rels.async("string"))?.[1];
  const file = target ? zip.file(`ppt/notesSlides/${target}`) : null;
  if (!file) return "";
  return drawingMlText(await file.async("string"))
    .split("\n")
    .filter((l) => !/^\d+$/.test(l)) // drop slide-number placeholders
    .join("\n");
}

// ───────────── CSV ─────────────

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t", "|"].map((d) => {
    let n = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n++;
    }
    return [d, n] as const;
  });
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** RFC 4180-style CSV parser (quoted fields, escaped quotes, embedded newlines). */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\ufeff/, "");
  const d = delimiter ?? detectDelimiter(src.slice(0, src.indexOf("\n") === -1 ? undefined : src.indexOf("\n")));
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === d) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function parseCsvDocument(text: string): Section[] {
  const rows = parseCsv(text).slice(0, MAX_SHEET_ROWS);
  if (!rows.length) return [];
  const lines = renderTable(rows);
  const header = rows.length > 1 ? `${lines[0]}\n${lines[1]}` : undefined;
  return [{ text: lines.join("\n"), meta: {}, prefix: header }];
}

// ───────────── JSON ─────────────

function parseJson(text: string): Section[] {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\ufeff/, ""));
  } catch {
    throw new ParseError("The file is not valid JSON.");
  }
  return [{ text: JSON.stringify(value, null, 2), meta: {} }];
}
