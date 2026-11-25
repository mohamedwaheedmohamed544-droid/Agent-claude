import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";
import { resumeStaleTasks } from "@/lib/orchestrator/engine";
import { pruneRateLimits } from "@/lib/security/rate-limit";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Vercel Cron: resumes stalled tasks, expires approvals, prunes rate-limit and session rows. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  const resumed = await resumeStaleTasks(10);
  const expired = await query("UPDATE approvals SET status='expired' WHERE status='pending' AND expires_at < now() RETURNING id");
  await pruneRateLimits();
  await query("DELETE FROM sessions WHERE expires_at < now()");
  await query("DELETE FROM oauth_states WHERE expires_at < now()");
  await query("DELETE FROM api_request_logs WHERE created_at < now() - interval '30 days'");
  return NextResponse.json({ resumed: resumed.length, approvalsExpired: expired.length });
}
