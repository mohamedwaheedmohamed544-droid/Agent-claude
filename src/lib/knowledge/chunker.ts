import { estimateTokens } from "../ai/models";
import type { Section, SectionMeta } from "./parsers";

/**
 * Token-aware chunker. Text is broken into units along natural boundaries (paragraphs → lines →
 * sentences → words), then packed greedily up to the target size with a trailing overlap carried
 * into the next chunk. Sentence splitting understands Arabic punctuation (؟ ۔) as well as Latin.
 */

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
  /** Hard ceiling for a single chunk; units larger than this are cut. */
  maxTokens?: number;
}

export interface ChunkMetadata extends SectionMeta {
  heading?: string;
}

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
  metadata: ChunkMetadata;
}

interface Unit {
  text: string;
  tokens: number;
  /** Separator placed before this unit when it follows another in the same chunk. */
  sep: string;
  heading?: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/;
const SENTENCE_SPLIT_RE = /(?<=[.!?؟۔…])\s+|(?<=[。！？])/u;

export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(SENTENCE_SPLIT_RE))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cuts text that has no usable boundaries into pieces of at most `max` tokens, preferring word breaks. */
function hardSplit(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (estimateTokens(rest) > max) {
    let lo = 1;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (estimateTokens(rest.slice(0, mid)) <= max) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;
    const space = rest.lastIndexOf(" ", lo);
    if (space > lo * 0.6) cut = space;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/** Splits an oversized block into pieces that each fit `max`, joined back with the right separators. */
function splitBlock(block: string, max: number): Array<{ text: string; sep: string }> {
  if (estimateTokens(block) <= max) return [{ text: block, sep: "\n\n" }];
  const lines = block.split("\n").filter((l) => l.trim());
  const pieces: Array<{ text: string; sep: string }> = [];
  for (const [li, line] of lines.entries()) {
    const lineSep = li === 0 ? "\n\n" : "\n";
    if (estimateTokens(line) <= max) { pieces.push({ text: line, sep: lineSep }); continue; }
    splitSentences(line).forEach((sentence, si) => {
      const sentSep = si === 0 ? lineSep : " ";
      hardSplit(sentence, max).forEach((part, pi) => pieces.push({ text: part, sep: pi === 0 ? sentSep : " " }));
    });
  }
  return pieces;
}

function toUnits(text: string, max: number): Unit[] {
  const units: Unit[] = [];
  let heading: string | undefined;
  for (const block of text.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // A heading line at the top of a block updates the running heading for what follows.
    const firstLine = trimmed.split("\n", 1)[0];
    const h = HEADING_RE.exec(firstLine);
    if (h) heading = h[2].slice(0, 200);
    for (const p of splitBlock(trimmed, max)) {
      const lineHeading = HEADING_RE.exec(p.text);
      if (lineHeading) heading = lineHeading[2].slice(0, 200);
      units.push({ text: p.text, tokens: estimateTokens(p.text), sep: p.sep, heading });
    }
  }
  return units;
}

function joinUnits(units: Unit[]): string {
  return units.map((u, i) => (i === 0 ? u.text : u.sep + u.text)).join("");
}

/** Trailing slice of text worth roughly `tokens` tokens, starting at a word boundary. */
function tailText(text: string, tokens: number): string {
  if (tokens <= 0) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (estimateTokens(text.slice(mid)) <= tokens) hi = mid;
    else lo = mid + 1;
  }
  const space = text.indexOf(" ", lo);
  const start = space !== -1 && space - lo < 40 ? space + 1 : lo;
  return text.slice(start).trim();
}

export function chunkSections(sections: Section[], opts: ChunkOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? 700;
  const overlap = Math.min(opts.overlapTokens ?? 100, Math.floor(target / 3));
  const hardMax = Math.max(opts.maxTokens ?? Math.round(target * 1.25), target);
  const chunks: Chunk[] = [];

  for (const section of sections) {
    let prefix = section.prefix?.trim();
    // A very wide header row would crowd out content; fall back to its first line (the heading).
    if (prefix && estimateTokens(prefix) > target / 4) prefix = prefix.split("\n", 1)[0].slice(0, 200);
    const prefixTokens = prefix ? estimateTokens(prefix) + 1 : 0;
    // Units must leave room for the repeated prefix and the overlap carried in.
    const unitMax = Math.max(32, target - prefixTokens - overlap);
    const units = toUnits(section.text, unitMax);
    let current: Unit[] = [];
    let currentTokens = 0;
    let firstInSection = true;
    let hasNew = false;

    const emit = () => {
      if (!current.length || !hasNew) return;
      const body = joinUnits(current);
      const content = prefix && !firstInSection ? `${prefix}\n${body}` : body;
      const heading = current.find((u) => u.heading)?.heading ?? current[current.length - 1].heading;
      const metadata: ChunkMetadata = { ...section.meta };
      if (heading) metadata.heading = heading;
      chunks.push({ index: chunks.length, content, tokenCount: estimateTokens(content), metadata });
      firstInSection = false;

      // Carry whole trailing units into the next chunk while they fit the overlap budget,
      // otherwise a word-aligned tail of the last unit.
      const carry: Unit[] = [];
      let carried = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (carried + current[i].tokens > overlap) break;
        carry.unshift(current[i]);
        carried += current[i].tokens;
      }
      if (!carry.length && overlap > 0) {
        const last = current[current.length - 1];
        const tail = tailText(last.text, overlap);
        if (tail && tail !== last.text) {
          carry.push({ text: tail, tokens: estimateTokens(tail), sep: last.sep, heading: last.heading });
          carried = carry[0].tokens;
        }
      }
      current = carry;
      currentTokens = carried;
      hasNew = false;
    };

    for (const u of units) {
      const budget = target - (firstInSection ? 0 : prefixTokens);
      if (current.length && currentTokens + u.tokens > budget && hasNew) emit();
      current.push(u);
      currentTokens += u.tokens;
      hasNew = true;
    }
    emit();
  }

  // Final guard: nothing may exceed the hard ceiling (e.g. a very long prefix).
  return chunks.flatMap((c) => {
    if (c.tokenCount <= hardMax) return [c];
    return hardSplit(c.content, hardMax).map((content) => ({ ...c, content, tokenCount: estimateTokens(content) }));
  }).map((c, index) => ({ ...c, index }));
}
