/* ── Server-side Pro gate ─────────────────────────────────────────────
   Mirrors the client `isPro` logic in src/hooks/useSubscription.js so a
   bypassed UI can't backdoor a Pro endpoint. Trial users do NOT count
   as Pro — same convention as documents / encryption / calendar gates.

   Rules (must stay in sync with useSubscription.js):
     - admin email           → Pro
     - comp_granted = true   → Pro
     - status in PAID_STATUS → Pro
     - status = "trialing" with default_payment_method → Pro
     - everything else       → not Pro

   Used by Pro-gated endpoints to reject non-Pro callers before they
   hit any expensive downstream work (Anthropic, R2, etc). */

import { getServiceClient } from "./_admin.js";

const ADMIN_EMAIL = "gaxioladiego@gmail.com";
const PAID_STATUSES = new Set(["active", "past_due"]);

export async function isProUser(user) {
  if (!user) return false;
  if (user.email === ADMIN_EMAIL) return true;

  const svc = getServiceClient();
  const { data, error } = await svc
    .from("user_subscriptions")
    .select("status, comp_granted, default_payment_method")
    .eq("user_id", user.id)
    .maybeSingle();

  // No row yet (never started checkout) → not Pro. A missing row is
  // expected for fresh accounts and is not an error.
  if (error || !data) return false;

  if (data.comp_granted) return true;
  if (PAID_STATUSES.has(data.status)) return true;
  if (data.status === "trialing" && data.default_payment_method) return true;
  return false;
}
