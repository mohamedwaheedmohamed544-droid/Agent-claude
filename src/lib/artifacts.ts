import { Document, HeadingLevel, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType } from "docx";
import ExcelJS from "exceljs";
import { queryOne } from "./db";
import { redactSecrets } from "./security/crypto";

export type ArtifactKind = "document" | "spreadsheet" | "email_draft" | "report" | "presentation_outline" | "other";
export type ArtifactFormat = "markdown" | "docx" | "xlsx" | "json" | "text";

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  title: string;
  format: ArtifactFormat;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

const MIME: Record<ArtifactFormat, string> = {
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const EXTENSION: Record<ArtifactFormat, string> = { markdown: "md", text: "txt", json: "json", docx: "docx", xlsx: "xlsx" };

const isArabic = (s: string) => /[؀-ۿ]/.test(s);

function inlineRuns(text: string, rtl: boolean): TextRun[] {
  // **bold** and *italic* support
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((p) => {
    if (p.startsWith("**") && p.endsWith("**")) return new TextRun({ text: p.slice(2, -2), bold: true, rightToLeft: rtl });
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return new TextRun({ text: p.slice(1, -1), italics: true, rightToLeft: rtl });
    return new TextRun({ text: p, rightToLeft: rtl });
  });
}

/** Converts a practical subset of Markdown (headings, lists, tables, bold/italic) to DOCX. RTL-aware. */
export async function markdownToDocx(title: string, markdown: string): Promise<Buffer> {
  const rtlDoc = isArabic(markdown.slice(0, 2000));
  const children: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.TITLE, bidirectional: rtlDoc, alignment: rtlDoc ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: title, rightToLeft: rtlDoc })] }),
  ];
  const lines = markdown.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rtl = isArabic(line) || rtlDoc;
    const align = rtl ? AlignmentType.RIGHT : AlignmentType.LEFT;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      i--;
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        visuallyRightToLeft: rtl,
        rows: rows.map((r, ri) => new TableRow({
          children: r.map((c) => new TableCell({ children: [new Paragraph({ bidirectional: rtl, alignment: align, children: [new TextRun({ text: c, bold: ri === 0, rightToLeft: rtl })] })] })),
        })),
      }));
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][h[1].length - 1];
      children.push(new Paragraph({ heading: level, bidirectional: rtl, alignment: align, children: inlineRuns(h[2], rtl) }));
    } else if (/^\s*[-*]\s+/.test(line)) {
      children.push(new Paragraph({ bullet: { level: 0 }, bidirectional: rtl, alignment: align, children: inlineRuns(line.replace(/^\s*[-*]\s+/, ""), rtl) }));
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      children.push(new Paragraph({ bidirectional: rtl, alignment: align, children: inlineRuns(line.trim(), rtl) }));
    } else if (line.trim()) {
      children.push(new Paragraph({ bidirectional: rtl, alignment: align, spacing: { after: 120 }, children: inlineRuns(line, rtl) }));
    }
  }
  const doc = new Document({ creator: "Nexus AI", title, sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function rowsToXlsx(title: string, sheets: Array<{ name: string; columns: string[]; rows: Array<Array<string | number | null>> }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nexus AI";
  wb.title = title;
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet");
    if (isArabic(s.columns.join(" ") + JSON.stringify(s.rows.slice(0, 3)))) ws.views = [{ rightToLeft: true }];
    ws.addRow(s.columns).font = { bold: true };
    s.rows.forEach((r) => ws.addRow(r));
    ws.columns.forEach((c, i) => {
      const max = Math.max(String(s.columns[i] ?? "").length, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? "").length));
      c.width = Math.min(60, Math.max(10, max + 2));
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, s.columns.length) } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface NewArtifact {
  workspaceId: string;
  taskId?: string | null;
  stepId?: string | null;
  conversationId?: string | null;
  agentSlug?: string | null;
  kind: ArtifactKind;
  title: string;
  format: ArtifactFormat;
  text?: string;
  bytes?: Buffer;
}

export async function saveArtifact(a: NewArtifact): Promise<ArtifactRecord> {
  const text = a.text !== undefined ? redactSecrets(a.text) : null;
  const size = a.bytes?.length ?? Buffer.byteLength(text ?? "");
  const row = await queryOne<ArtifactRecord>(
    `INSERT INTO generated_artifacts(workspace_id, task_id, step_id, conversation_id, kind, title, format, mime_type, content_text, content_bytes, size_bytes, agent_slug)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, kind, title, format, mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at AS "createdAt"`,
    [a.workspaceId, a.taskId ?? null, a.stepId ?? null, a.conversationId ?? null, a.kind, a.title.slice(0, 200), a.format, MIME[a.format],
      text, a.bytes ?? null, size, a.agentSlug ?? null],
  );
  return row!;
}
