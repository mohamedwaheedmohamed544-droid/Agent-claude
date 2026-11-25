import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { query, queryOne } from "@/lib/db";
import { estimateTokens } from "@/lib/ai/models";
import { chunkSections, splitSentences } from "@/lib/knowledge/chunker";
import { parseDocument, parseCsv } from "@/lib/knowledge/parsers";
import { sanitizeFilename, validateUpload, UploadRejected } from "@/lib/knowledge/validation";
import { ingestUpload, reprocessFile } from "@/lib/knowledge/ingest";
import { deleteFile, getFileContent, getFileDetail, listFiles, moveFile } from "@/lib/knowledge/store";
import { createBase, deleteBase, listBases, updateBase } from "@/lib/knowledge/bases";
import { searchKnowledge } from "@/lib/knowledge/search";
import { makeUser } from "./helpers";

// ───────────── Fixture builders ─────────────

/** Builds a small, valid multi-page PDF (Helvetica, one text line per page) with a correct xref table. */
function makePdf(pages: string[]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((text, i) => {
    const esc = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const stream = `BT /F1 12 Tf 72 720 Td (${esc}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function makeDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Quarterly Strategy", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun("Our expansion focuses on the Riyadh logistics corridor.")] }),
        new Paragraph({ children: [new TextRun("خطة التوسع تشمل مدينة الرياض والدمام.")] }),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function makeXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sales = wb.addWorksheet("Sales");
  sales.addRow(["Region", "Revenue", "Note"]);
  sales.addRow(["Riyadh", 120000, "Strong | growth"]);
  sales.addRow(["Jeddah", { formula: "B2/2", result: 60000 }, "مستقر"]);
  const staff = wb.addWorksheet("الموظفون");
  staff.addRow(["الاسم", "القسم"]);
  staff.addRow(["سارة", "المالية"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function slideXml(paragraphs: string[]): string {
  const ps = paragraphs.map((p) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${p}</a:t></a:r></a:p>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${ps}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

async function makePptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  zip.file("ppt/slides/slide1.xml", slideXml(["Welcome to Nexus", "Agenda &amp; goals"]));
  zip.file("ppt/slides/slide2.xml", slideXml(["مرحبا بكم في العرض"]));
  zip.file("ppt/slides/slide10.xml", slideXml(["Closing remarks"]));
  zip.file("ppt/slides/_rels/slide2.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>`);
  zip.file("ppt/notesSlides/notesSlide7.xml", slideXml(["Speaker note for slide two", "2"]));
  return zip.generateAsync({ type: "nodebuffer" });
}

const longEnglish = (n: number) => Array.from({ length: n }, (_, i) =>
  `Paragraph ${i} explains topic ${i} in detail. It has a second sentence about item${i} and its operational impact. A third sentence closes the thought.`,
).join("\n\n");

// ───────────── Parsers ─────────────

describe("parsers", () => {
  it("extracts PDF text per page", async () => {
    const doc = await parseDocument("pdf", makePdf(["Quarterly revenue grew strongly", "Logistics overview (page two)"]));
    expect(doc.sections.map((s) => s.meta.page)).toEqual([1, 2]);
    expect(doc.sections[0].text).toContain("Quarterly revenue grew strongly");
    expect(doc.text).toContain("[Page 2]");
    expect(doc.text).toContain("Logistics overview (page two)");
  });

  it("extracts DOCX text including Arabic", async () => {
    const doc = await parseDocument("docx", await makeDocx());
    expect(doc.text).toContain("Quarterly Strategy");
    expect(doc.text).toContain("Riyadh logistics corridor");
    expect(doc.text).toContain("خطة التوسع تشمل مدينة الرياض والدمام.");
  });

  it("renders XLSX sheets as tables with sheet names and formula results", async () => {
    const doc = await parseDocument("xlsx", await makeXlsx());
    expect(doc.sections.map((s) => s.meta.sheet)).toEqual(["Sales", "الموظفون"]);
    expect(doc.text).toContain("## Sheet: Sales");
    expect(doc.text).toContain("| Region | Revenue | Note |");
    expect(doc.text).toContain("| Riyadh | 120000 | Strong \\| growth |");
    expect(doc.text).toContain("| Jeddah | 60000 | مستقر |");
    expect(doc.text).toContain("## Sheet: الموظفون");
    expect(doc.text).toContain("| سارة | المالية |");
  });

  it("reads PPTX slides in numeric order with speaker notes", async () => {
    const doc = await parseDocument("pptx", await makePptx());
    expect(doc.sections.map((s) => s.meta.slide)).toEqual([1, 2, 10]);
    expect(doc.sections[0].text).toBe("Slide 1\nWelcome to Nexus\nAgenda & goals");
    expect(doc.sections[1].text).toContain("مرحبا بكم في العرض");
    expect(doc.sections[1].text).toContain("Notes:\nSpeaker note for slide two");
    expect(doc.sections[1].text).not.toMatch(/\n2$/);
    expect(doc.sections[2].text).toBe("Slide 10\nClosing remarks");
  });

  it("parses CSV with quotes, embedded delimiters and Arabic", async () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    const doc = await parseDocument("csv", Buffer.from("name;city\nسارة;الرياض\nJohn;Jeddah\n", "utf8"));
    expect(doc.text).toContain("| name | city |");
    expect(doc.text).toContain("| سارة | الرياض |");
  });

  it("handles TXT, MD (with BOM) and JSON", async () => {
    const md = await parseDocument("md", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# العنوان\n\nنص عربي.\r\n", "utf8")]));
    expect(md.text).toBe("# العنوان\n\nنص عربي.");
    const json = await parseDocument("json", Buffer.from('{"title":"تقرير","n":1}', "utf8"));
    expect(json.text).toContain('"title": "تقرير"');
    const txt = await parseDocument("txt", Buffer.from("plain\u0000text", "utf8"));
    expect(txt.text).toBe("plaintext");
  });
});

// ───────────── Validation ─────────────

describe("upload validation", () => {
  it("accepts genuine files and assigns server-side MIME types", async () => {
    expect((await validateUpload("report.pdf", makePdf(["hi"]))).mimeType).toBe("application/pdf");
    expect((await validateUpload("plan.DOCX", await makeDocx())).kind).toBe("docx");
    expect((await validateUpload("data.xlsx", await makeXlsx())).kind).toBe("xlsx");
    expect((await validateUpload("deck.pptx", await makePptx())).kind).toBe("pptx");
  });

  it("rejects HTML disguised as PDF and other magic-byte mismatches", async () => {
    await expect(validateUpload("invoice.pdf", Buffer.from("<!DOCTYPE html><html><script>alert(1)</script></html>"))).rejects.toThrow(/does not match/);
    await expect(validateUpload("plan.docx", await makeXlsx())).rejects.toThrow(/does not match/);
    await expect(validateUpload("plan.docx", Buffer.from("not a zip"))).rejects.toThrow(/does not match/);
    await expect(validateUpload("notes.txt", makePdf(["x"]))).rejects.toThrow(/does not match/);
  });

  it("rejects HTML/SVG content, executables, binary text and disallowed extensions", async () => {
    await expect(validateUpload("page.txt", Buffer.from("  <html><body>x</body></html>"))).rejects.toThrow(/HTML and SVG/);
    await expect(validateUpload("logo.md", Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toThrow(/HTML and SVG/);
    await expect(validateUpload("page.html", Buffer.from("<p>x</p>"))).rejects.toMatchObject({ status: 415 });
    await expect(validateUpload("image.svg", Buffer.from("<svg/>"))).rejects.toMatchObject({ status: 415 });
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0]);
    await expect(validateUpload("run.txt", elf)).rejects.toThrow(/Executable/);
    const pe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)]);
    await expect(validateUpload("tool.csv", pe)).rejects.toThrow(/Executable/);
    await expect(validateUpload("bad.json", Buffer.from("{nope"))).rejects.toThrow(/valid JSON/);
    await expect(validateUpload("latin1.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9]))).rejects.toThrow(/UTF-8/);
    await expect(validateUpload("empty.txt", Buffer.alloc(0))).rejects.toBeInstanceOf(UploadRejected);
  });

  it("enforces the configured size limit", async () => {
    const prev = process.env.NEXUS_MAX_UPLOAD_MB;
    process.env.NEXUS_MAX_UPLOAD_MB = "1";
    try {
      await expect(validateUpload("big.txt", Buffer.alloc(1024 * 1024 + 1, 0x61))).rejects.toMatchObject({ status: 413 });
      await expect(validateUpload("ok.txt", Buffer.alloc(1024 * 1024, 0x61))).resolves.toBeTruthy();
      process.env.NEXUS_MAX_UPLOAD_MB = "999"; // clamped to the 15 MB hard cap
      await expect(validateUpload("huge.txt", Buffer.alloc(15 * 1024 * 1024 + 1, 0x61))).rejects.toMatchObject({ status: 413 });
    } finally {
      if (prev === undefined) delete process.env.NEXUS_MAX_UPLOAD_MB; else process.env.NEXUS_MAX_UPLOAD_MB = prev;
    }
  });

  it("sanitizes filenames but keeps Arabic", () => {
    expect(sanitizeFilename("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFilename("C:\\Users\\x\\تقرير الربع.pdf")).toBe("تقرير الربع.pdf");
    expect(sanitizeFilename("evil\u202Etxt.exe.pdf")).toBe("eviltxt.exe.pdf");
    expect(sanitizeFilename('a<b>:"c|?*.md')).toBe("a_b___c___.md");
    expect(sanitizeFilename("   .pdf")).toBe("file.pdf");
    expect(sanitizeFilename(`${"x".repeat(300)}.docx`)).toMatch(/^x+\.docx$/);
    expect(sanitizeFilename(`${"x".repeat(300)}.docx`).length).toBeLessThanOrEqual(180);
  });
});

// ───────────── Chunker ─────────────

describe("chunker", () => {
  it("respects the token target and overlaps consecutive chunks", () => {
    const chunks = chunkSections([{ text: longEnglish(80), meta: {} }], { targetTokens: 200, overlapTokens: 40 });
    expect(chunks.length).toBeGreaterThan(5);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.tokenCount).toBeLessThanOrEqual(250);
      expect(c.tokenCount).toBe(estimateTokens(c.content));
    });
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].content.slice(-60);
      const overlapProbe = prevTail.slice(prevTail.indexOf(" ") + 1, prevTail.indexOf(" ") + 25);
      expect(chunks[i].content).toContain(overlapProbe);
    }
    // Every paragraph survives somewhere.
    const all = chunks.map((c) => c.content).join("\n");
    for (let i = 0; i < 80; i += 7) expect(all).toContain(`about item${i} and`);
  });

  it("uses the default ~700 token target", () => {
    const chunks = chunkSections([{ text: longEnglish(200), meta: {} }]);
    expect(chunks.length).toBeGreaterThan(3);
    expect(Math.max(...chunks.map((c) => c.tokenCount))).toBeLessThanOrEqual(875);
    expect(chunks.slice(0, -1).every((c) => c.tokenCount >= 400)).toBe(true);
  });

  it("splits oversized unbroken text and never exceeds the hard ceiling", () => {
    const blob = "word ".repeat(5000) + "x".repeat(6000);
    const chunks = chunkSections([{ text: blob, meta: {} }], { targetTokens: 300, overlapTokens: 50 });
    expect(chunks.every((c) => c.tokenCount <= 375)).toBe(true);
  });

  it("keeps section metadata and markdown headings", () => {
    const chunks = chunkSections([
      { text: "# Intro\n\nShort intro.", meta: { page: 1 } },
      { text: "Slide 3\nContent", meta: { slide: 3 } },
      { text: `## Sheet: Data\n\n| a | b |\n| --- | --- |\n${Array.from({ length: 200 }, (_, i) => `| r${i} | v${i} |`).join("\n")}`, meta: { sheet: "Data" }, prefix: "## Sheet: Data\n| a | b |\n| --- | --- |" },
    ], { targetTokens: 150, overlapTokens: 20 });
    expect(chunks[0].metadata).toEqual({ page: 1, heading: "Intro" });
    expect(chunks[1].metadata).toEqual({ slide: 3 });
    const sheetChunks = chunks.filter((c) => c.metadata.sheet === "Data");
    expect(sheetChunks.length).toBeGreaterThan(2);
    // Later chunks of a sheet repeat the header so each chunk is self-describing.
    expect(sheetChunks.slice(1).every((c) => c.content.startsWith("## Sheet: Data\n| a | b |"))).toBe(true);
    expect(sheetChunks.every((c) => c.metadata.heading === "Sheet: Data")).toBe(true);
  });

  it("splits Arabic sentences on Arabic punctuation and round-trips text", () => {
    expect(splitSentences("هل وصل التقرير؟ نعم وصل. شكرا!\nسطر جديد")).toEqual(["هل وصل التقرير؟", "نعم وصل.", "شكرا!", "سطر جديد"]);
    const arabic = Array.from({ length: 120 }, (_, i) => `هذه الجملة رقم ${i} تتحدث عن خطة التوسع في المملكة؟ نعم، وهي جملة طويلة نسبيا للاختبار.`).join(" ");
    const chunks = chunkSections([{ text: arabic, meta: {} }], { targetTokens: 200, overlapTokens: 30 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.tokenCount <= 250)).toBe(true);
    // Chunk boundaries fall on sentence ends, not mid-word.
    expect(chunks.slice(0, -1).every((c) => /[؟.]$/.test(c.content))).toBe(true);
    expect(chunks.map((c) => c.content).join(" ")).toContain("هذه الجملة رقم 119 تتحدث عن خطة التوسع في المملكة؟");
  });
});

// ───────────── Ingestion, search, isolation ─────────────

describe("ingestion and search", () => {
  let A: Awaited<ReturnType<typeof makeUser>>;
  let B: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    A = await makeUser("Alice");
    B = await makeUser("Bob");
  });

  it("ingests a document end to end and search finds the right chunk", async () => {
    const text = [
      "# Onboarding", "New hires receive a laptop on day one.",
      "# Expense policy", "Travel expenses above 5000 SAR require director approval within 30 days.",
      "# Security", "Passwords must be rotated every ninety days.",
    ].join("\n\n") + "\n\n" + longEnglish(60);
    const { file, duplicate } = await ingestUpload({ workspaceId: A.workspaceId, userId: A.userId, filename: "handbook.md", bytes: Buffer.from(text, "utf8") });
    expect(duplicate).toBe(false);
    expect(file.status).toBe("ready");
    expect(file.error).toBeNull();
    expect(file.chunkCount).toBeGreaterThan(1);
    expect(file.mimeType).toBe("text/markdown");

    const emb = await queryOne<{ n: string }>(
      "SELECT count(*) AS n FROM embeddings e JOIN document_chunks c ON c.id=e.chunk_id WHERE c.file_id=$1", [file.id],
    );
    expect(Number(emb!.n)).toBe(file.chunkCount);

    const hits = await searchKnowledge(A.workspaceId, "travel expenses director approval", { userId: A.userId });
    expect(hits[0].fileId).toBe(file.id);
    expect(hits[0].content).toContain("director approval");
    expect(hits[0].metadata.heading).toBe("Onboarding");

    const detail = await getFileDetail(A.workspaceId, file.id);
    expect(detail.preview.startsWith("# Onboarding")).toBe(true);
    expect(detail.chunks.length).toBe(file.chunkCount);
    expect(detail.chunks[0].content.length).toBeLessThanOrEqual(300);
  });

  it("round-trips Arabic documents through ingestion and retrieval", async () => {
    const bytes = await makeDocx();
    const { file } = await ingestUpload({ workspaceId: A.workspaceId, userId: A.userId, filename: "خطة الربع.docx", bytes });
    expect(file.filename).toBe("خطة الربع.docx");
    expect(file.status).toBe("ready");
    const hits = await searchKnowledge(A.workspaceId, "الرياض", { userId: A.userId });
    expect(hits.some((h) => h.fileId === file.id && h.content.includes("خطة التوسع تشمل مدينة الرياض والدمام."))).toBe(true);
    const stored = await getFileContent(A.workspaceId, file.id);
    expect(Buffer.compare(stored!.content, bytes)).toBe(0);
  });

  it("deduplicates identical uploads within a workspace but not across workspaces", async () => {
    const bytes = Buffer.from("Unique dedupe content 7f3a about procurement.", "utf8");
    const first = await ingestUpload({ workspaceId: A.workspaceId, userId: A.userId, filename: "a.txt", bytes });
    const again = await ingestUpload({ workspaceId: A.workspaceId, userId: A.userId, filename: "renamed.txt", bytes });
    expect(again.duplicate).toBe(true);
    expect(again.file.id).toBe(first.file.id);
    const n = await queryOne<{ n: string }>("SELECT count(*) AS n FROM knowledge_files WHERE workspace_id=$1 AND sha256=(SELECT sha256 FROM knowledge_files WHERE id=$2)", [A.workspaceId, first.file.id]);
    expect(Number(n!.n)).toBe(1);
    const other = await ingestUpload({ workspaceId: B.workspaceId, userId: B.userId, filename: "a.txt", bytes });
    expect(other.duplicate).toBe(false);
    expect(other.file.id).not.toBe(first.file.id);
  });

  it("marks unreadable documents as failed with a safe message, and reprocess re-runs", async () => {
    // Passes magic-byte validation (header present) but is not a parseable PDF.
    const broken = Buffer.from("%PDF-1.4\n% garbage without objects\n", "latin1");
    const { file } = await ingestUpload({ workspaceId: A.workspaceId, userId: A.userId, filename: "broken.pdf", bytes: broken });
    expect(file.status).toBe("failed");
    expect(file.error).toMatch(/PDF|extract/i);
    expect(file.chunkCount).toBe(0);
    const again = await reprocessFile(A.workspaceId, file.id, { userId: A.userId });
    expect(again.status).toBe("failed");
  });

  it("keeps chunks and marks ready with a warning when embeddings are unavailable", async () => {
    const prev = process.env.NEXUS_LLM_PROVIDER;
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.NEXUS_LLM_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    try {
      const { file } = await ingestUpload({
        workspaceId: B.workspaceId, userId: B.userId, filename: "no-embed.txt",
        bytes: Buffer.from("Warehouse inventory reconciliation happens every Thursday.", "utf8"),
      });
      expect(file.status).toBe("ready");
      expect(file.chunkCount).toBe(1);
      expect(file.error).toMatch(/^warning: /);
      const hits = await searchKnowledge(B.workspaceId, "inventory reconciliation", { userId: B.userId });
      expect(hits[0]?.fileId).toBe(file.id);
    } finally {
      process.env.NEXUS_LLM_PROVIDER = prev;
      if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
    }
  });

  it("ingests spreadsheets, presentations and PDFs with location metadata", async () => {
    const x = await ingestUpload({ workspaceId: A.workspaceId, userId: A.userId, filename: "sales.xlsx", bytes: await makeXlsx() });
    const p = await ingestUpload({ workspaceId: A.workspaceId, userId: A.userId, filename: "deck.pptx", bytes: await makePptx() });
    const d = await ingestUpload({ workspaceId: A.workspaceId, userId: A.userId, filename: "report.pdf", bytes: makePdf(["Introduction page", "Zanzibar shipping forecast details"]) });
    for (const f of [x, p, d]) expect(f.file, f.file.error ?? "").toMatchObject({ status: "ready" });
    const pdfHit = (await searchKnowledge(A.workspaceId, "Zanzibar shipping forecast", { userId: A.userId }))[0];
    expect(pdfHit.fileId).toBe(d.file.id);
    expect(pdfHit.metadata.page).toBe(2);
    const slideHit = (await searchKnowledge(A.workspaceId, "Closing remarks", { userId: A.userId }))[0];
    expect(slideHit.metadata.slide).toBe(10);
    const sheetHit = (await searchKnowledge(A.workspaceId, "سارة المالية", { userId: A.userId }))[0];
    expect(sheetHit.metadata.sheet).toBe("الموظفون");
  });

  it("manages knowledge bases, moves files and scopes search to a base", async () => {
    const kb = await createBase(A.workspaceId, A.userId, { name: "Legal", description: "Contracts" });
    await expect(createBase(A.workspaceId, A.userId, { name: "legal" })).rejects.toMatchObject({ status: 409 });
    const { file } = await ingestUpload({
      workspaceId: A.workspaceId, userId: A.userId, filename: "nda.txt", knowledgeBaseId: kb.id,
      bytes: Buffer.from("The non-disclosure agreement term is three years from signature.", "utf8"),
    });
    expect(file.knowledgeBaseId).toBe(kb.id);
    const { bases } = await listBases(A.workspaceId);
    const legal = bases.find((b) => b.id === kb.id)!;
    expect(legal.fileCount).toBe(1);
    expect(legal.chunkCount).toBe(1);

    const scoped = await searchKnowledge(A.workspaceId, "non-disclosure agreement", { userId: A.userId }, { knowledgeBaseId: kb.id });
    expect(scoped.every((h) => h.fileId === file.id)).toBe(true);
    expect(scoped.length).toBeGreaterThan(0);
    expect(await listFiles(A.workspaceId, { knowledgeBaseId: kb.id })).toHaveLength(1);
    expect((await listFiles(A.workspaceId, { q: "nda" }))[0].uploadedByName).toBe("Alice");

    const renamed = await updateBase(A.workspaceId, kb.id, { name: "Legal & Compliance", description: null });
    expect(renamed.name).toBe("Legal & Compliance");
    expect(renamed.description).toBeNull();

    const moved = await moveFile(A.workspaceId, file.id, null);
    expect(moved.knowledgeBaseId).toBeNull();
    await moveFile(A.workspaceId, file.id, kb.id);

    // Deleting a base keeps its files.
    const r = await deleteBase(A.workspaceId, kb.id);
    expect(r.detachedFiles).toBe(1);
    const still = await listFiles(A.workspaceId, { q: "nda" });
    expect(still).toHaveLength(1);
    expect(still[0].knowledgeBaseId).toBeNull();
  });

  it("enforces workspace isolation for search, read, move and delete", async () => {
    const secret = await ingestUpload({
      workspaceId: A.workspaceId, userId: A.userId, filename: "secret.txt",
      bytes: Buffer.from("Project Bluefin acquisition price is confidential.", "utf8"),
    });
    const id = secret.file.id;

    const bHits = await searchKnowledge(B.workspaceId, "Project Bluefin acquisition", { userId: B.userId });
    expect(bHits.some((h) => h.fileId === id || h.content.includes("Bluefin"))).toBe(false);
    expect(await searchKnowledge(B.workspaceId, "Bluefin", { userId: B.userId }, { fileIds: [id] })).toHaveLength(0);
    expect((await listFiles(B.workspaceId)).some((f) => f.id === id)).toBe(false);
    await expect(getFileDetail(B.workspaceId, id)).rejects.toMatchObject({ status: 404 });
    expect(await getFileContent(B.workspaceId, id)).toBeNull();
    await expect(moveFile(B.workspaceId, id, null)).rejects.toMatchObject({ status: 404 });
    await expect(reprocessFile(B.workspaceId, id)).rejects.toMatchObject({ status: 404 });
    expect(await deleteFile(B.workspaceId, id)).toBeNull();

    // B cannot file its own document into A's knowledge base, nor delete A's bases.
    const { bases } = await listBases(A.workspaceId);
    await expect(ingestUpload({ workspaceId: B.workspaceId, userId: B.userId, filename: "x.txt", knowledgeBaseId: bases[0].id, bytes: Buffer.from("x y z") }))
      .rejects.toMatchObject({ status: 404 });
    await expect(deleteBase(B.workspaceId, bases[0].id)).rejects.toMatchObject({ status: 404 });
    await expect(updateBase(B.workspaceId, bases[0].id, { name: "pwned" })).rejects.toMatchObject({ status: 404 });

    // A's file is untouched, and A can delete it; chunks and embeddings cascade.
    expect(await deleteFile(A.workspaceId, id)).toEqual({ filename: "secret.txt" });
    const left = await query("SELECT 1 FROM document_chunks WHERE file_id=$1", [id]);
    expect(left).toHaveLength(0);
  });
});
