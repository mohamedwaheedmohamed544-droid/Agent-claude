/**
 * Prompt-injection defence: external content is wrapped in <untrusted_data> blocks.
 * Any delimiter-looking tags inside the content are neutralised so content cannot
 * "close" the block and smuggle instructions outside it.
 */
export function wrapUntrusted(source: string, content: string): string {
  const safeSource = source.replace(/[^\p{L}\p{N} _.:/@#-]/gu, "").slice(0, 200);
  const safe = content.replace(/<\/?\s*untrusted_data[^>]*>/gi, "[tag removed]").replace(/<\/?\s*(system|developer|assistant|user_request)\b[^>]*>/gi, "[tag removed]");
  return `<untrusted_data source="${safeSource}">\n${safe}\n</untrusted_data>`;
}

const INJECTION_HINTS = [
  /ignore (all|any|the)? ?(previous|prior|above) (instructions|prompts)/i,
  /disregard (the )?(system|previous) (prompt|instructions)/i,
  /you are now (a|an|the)\b/i,
  /(reveal|print|show) (your|the) (system prompt|instructions|api key)/i,
  /تجاهل (جميع |كل )?التعليمات/,
];

/** Heuristic flag used for audit/telemetry; the structural wrapper above is the actual defence. */
export function looksLikeInjection(content: string): boolean {
  return INJECTION_HINTS.some((re) => re.test(content));
}
