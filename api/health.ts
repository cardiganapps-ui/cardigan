/* ── GET /api/health ──
   Unauthenticated liveness + readiness probe for external uptime
   monitors (UptimeRobot, Cronitor, etc.). Returns:

     200 { status: "ok",       checks: { supabase: "ok", r2: "ok" }, ts }
     503 { status: "degraded", checks: { supabase: "...",  r2: "..." }, ts }

   Never returns user data. The Supabase check runs one cheap query
   through a table that exists in every environment; the R2 check
   issues a HeadBucket which is cheap and doesn't list contents. */

import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getR2, BUCKET } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const CHECK_TIMEOUT_MS = 4000;

function withTimeout(promise: Promise<unknown>, label: string) {
  return Promise.race([
    promise.then(() => "ok").catch((err: Row) => `error: ${err?.message || String(err)}`),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve(`timeout after ${CHECK_TIMEOUT_MS}ms`), CHECK_TIMEOUT_MS)
    ).then((msg) => `${label}: ${msg}`),
  ]);
}

async function checkSupabase() {
  const svc = getServiceClient();
  const { error } = await svc.from("patients").select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
}

async function checkR2() {
  const r2 = await getR2();
  await r2.send(new HeadBucketCommand({ Bucket: BUCKET }));
}

async function handler(req: Row, res: Row) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const [supabase, r2Status] = await Promise.all([
    withTimeout(checkSupabase(), "supabase"),
    withTimeout(checkR2(), "r2"),
  ]);

  const checks = { supabase, r2: r2Status };
  const ok = supabase === "ok" && r2Status === "ok";
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    checks,
    ts: new Date().toISOString(),
  });
}

export default withSentry(handler, { name: "health" });
