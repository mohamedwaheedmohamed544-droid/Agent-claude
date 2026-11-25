import { query, queryOne } from "../db";
import { tooMany } from "../errors";

/**
 * Fixed-window rate limiter backed by Postgres (works across serverless instances).
 * Throws AppError(429) when exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  // Test environments may scale limits up (e.g. many sign-ups from one IP in e2e). Never set in production.
  const scale = Math.max(1, Number(process.env.NEXUS_RATE_LIMIT_SCALE ?? 1) || 1);
  limit = limit * scale;
  const row = await queryOne<{ count: number }>(
    `INSERT INTO rate_limits(key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowSeconds],
  );
  if ((row?.count ?? 0) > limit) throw tooMany();
}

export async function pruneRateLimits(): Promise<void> {
  await query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}
