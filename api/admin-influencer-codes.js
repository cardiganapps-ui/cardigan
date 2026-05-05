/* ── /api/admin-influencer-codes ──────────────────────────────────────
   Admin-only CRUD for influencer / partner discount codes.

     POST  → create a code. Body: { code, percentOff, duration,
              durationInMonths?, influencerName?, notes? }
              Mints a Stripe Coupon + Promotion Code pair, then
              inserts a row in influencer_codes. Returns the row.

     GET   → list all codes with usage stats (signup count + paid
             conversion count joined from user_subscriptions).

     PATCH → toggle active flag. Body: { id, active }. Mirrors the
             change to the Stripe Promotion Code (so manual entry
             stops working) but never deletes the row, since
             user_subscriptions.influencer_code_id rows reference
             it for historical attribution.

   All paths gated by requireAdmin. The Stripe API is the slow path
   (~300ms per call); a per-admin rate limit catches accidental
   double-clicks but isn't tight enough to be annoying. */

import { requireAdmin, getServiceClient, logAuditEvent } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { rateLimit } from "./_ratelimit.js";
import { createCoupon, createPromotionCode, updatePromotionCode } from "./_stripe.js";

const CODE_RE = /^[A-Z0-9]{4,20}$/;
const DURATIONS = new Set(["once", "repeating", "forever"]);

function validateCreatePayload(body) {
  if (!body || typeof body !== "object") return "Cuerpo inválido";
  const code = String(body.code || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return "Código inválido (A-Z 0-9, 4-20 caracteres)";
  const percentOff = Number(body.percentOff);
  if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) {
    return "Porcentaje debe ser un entero entre 1 y 100";
  }
  const duration = String(body.duration || "");
  if (!DURATIONS.has(duration)) return "Duración inválida";
  let durationInMonths = null;
  if (duration === "repeating") {
    durationInMonths = Number(body.durationInMonths);
    if (!Number.isInteger(durationInMonths) || durationInMonths < 1 || durationInMonths > 12) {
      return "duration_in_months requerido (1-12) cuando duration='repeating'";
    }
  } else if (body.durationInMonths != null) {
    return "duration_in_months solo aplica cuando duration='repeating'";
  }
  const influencerName = body.influencerName ? String(body.influencerName).trim().slice(0, 80) : null;
  const notes = body.notes ? String(body.notes).trim().slice(0, 500) : null;
  return { code, percentOff, duration, durationInMonths, influencerName, notes };
}

async function handleCreate(req, res, admin) {
  const body = typeof req.body === "string" ? safeJsonParse(req.body) : (req.body || {});
  const parsed = validateCreatePayload(body);
  if (typeof parsed === "string") return res.status(400).json({ error: parsed });

  const svc = getServiceClient();

  // Cheap pre-check before hitting Stripe — avoids creating a Stripe
  // Coupon we'd then have to clean up if our DB rejects the insert.
  const { data: existing } = await svc
    .from("influencer_codes")
    .select("id")
    .eq("code", parsed.code)
    .maybeSingle();
  if (existing) return res.status(409).json({ error: "Ya existe un código con ese texto" });

  // Mint Coupon + Promotion Code in Stripe. If either fails we
  // surface the error verbatim — admin needs to know e.g. "code
  // already exists in Stripe" since codes are globally unique
  // within our Stripe account.
  let coupon, promo;
  try {
    coupon = await createCoupon({
      percentOff: parsed.percentOff,
      duration: parsed.duration,
      durationInMonths: parsed.durationInMonths,
      name: parsed.influencerName
        ? `${parsed.code} — ${parsed.influencerName} (${parsed.percentOff}% off)`
        : `${parsed.code} (${parsed.percentOff}% off)`,
      metadata: {
        cardigan_kind: "influencer",
        influencer_name: parsed.influencerName || "",
      },
    });
  } catch (err) {
    return res.status(502).json({ error: `Stripe coupon: ${err.message || "unknown"}` });
  }
  try {
    promo = await createPromotionCode({
      couponId: coupon.id,
      code: parsed.code,
      firstTimeOnly: true,
      metadata: { cardigan_kind: "influencer" },
    });
  } catch (err) {
    // Coupon is now orphaned in Stripe (no promo code attached).
    // Coupons without redemptions are harmless but ugly; admin can
    // delete from the Stripe dashboard if it bothers them.
    return res.status(502).json({ error: `Stripe promotion code: ${err.message || "unknown"}` });
  }

  const { data: row, error: insertErr } = await svc
    .from("influencer_codes")
    .insert({
      code: parsed.code,
      stripe_coupon_id: coupon.id,
      stripe_promotion_code_id: promo.id,
      influencer_name: parsed.influencerName,
      percent_off: parsed.percentOff,
      duration: parsed.duration,
      duration_in_months: parsed.durationInMonths,
      created_by: admin.id,
      notes: parsed.notes,
    })
    .select()
    .single();
  if (insertErr) {
    // Same orphan caveat — Stripe entries exist, DB row doesn't.
    return res.status(500).json({ error: `DB insert: ${insertErr.message}` });
  }
  await logAuditEvent(svc, {
    actorId: admin.id,
    action: "create_code",
    payload: {
      code: parsed.code,
      percent_off: parsed.percentOff,
      duration: parsed.duration,
      duration_in_months: parsed.durationInMonths,
      influencer_name: parsed.influencerName,
    },
    req,
  });
  return res.status(200).json({ ok: true, code: row });
}

async function handleList(req, res) {
  const svc = getServiceClient();
  const { data: codes, error } = await svc
    .from("influencer_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Per-code usage: how many user_subscriptions rows reference each
  // code (= signup attribution), and how many of those are now in a
  // paid status (= conversion). One pass over user_subscriptions
  // keyed by influencer_code_id.
  const ids = (codes || []).map(c => c.id);
  let usageByCode = new Map();
  if (ids.length) {
    const { data: subs } = await svc
      .from("user_subscriptions")
      .select("influencer_code_id, status, default_payment_method, comp_granted")
      .in("influencer_code_id", ids);
    for (const s of subs || []) {
      const key = s.influencer_code_id;
      if (!key) continue;
      const entry = usageByCode.get(key) || { signups: 0, paid: 0 };
      entry.signups += 1;
      const isPaid = !s.comp_granted && (
        s.status === "active" ||
        s.status === "past_due" ||
        (s.status === "trialing" && !!s.default_payment_method)
      );
      if (isPaid) entry.paid += 1;
      usageByCode.set(key, entry);
    }
  }

  const out = (codes || []).map(c => {
    const usage = usageByCode.get(c.id) || { signups: 0, paid: 0 };
    return {
      ...c,
      signup_count: usage.signups,
      paid_count: usage.paid,
    };
  });
  return res.status(200).json({ codes: out });
}

async function handleToggle(req, res, admin) {
  const body = typeof req.body === "string" ? safeJsonParse(req.body) : (req.body || {});
  const id = String(body?.id || "");
  const active = !!body?.active;
  if (!id) return res.status(400).json({ error: "id requerido" });

  const svc = getServiceClient();
  const { data: existing, error: lookupErr } = await svc
    .from("influencer_codes")
    .select("id, stripe_promotion_code_id, active")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) return res.status(500).json({ error: lookupErr.message });
  if (!existing) return res.status(404).json({ error: "Código no encontrado" });
  if (existing.active === active) {
    return res.status(200).json({ ok: true, unchanged: true });
  }

  // Flip Stripe first — if Stripe rejects, the DB stays consistent
  // with the customer-facing reality (the code's still usable). If
  // we flipped DB first and Stripe failed, manual entry would still
  // work even though our admin UI says "disabled".
  try {
    await updatePromotionCode(existing.stripe_promotion_code_id, { active });
  } catch (err) {
    return res.status(502).json({ error: `Stripe update: ${err.message || "unknown"}` });
  }

  const { error: updateErr } = await svc
    .from("influencer_codes")
    .update({ active })
    .eq("id", id);
  if (updateErr) {
    return res.status(500).json({ error: `DB update: ${updateErr.message}` });
  }
  await logAuditEvent(svc, {
    actorId: admin.id,
    action: "toggle_code",
    payload: { id, active },
    req,
  });
  return res.status(200).json({ ok: true });
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return; // requireAdmin already wrote the 401/403

  if (req.method === "GET") return handleList(req, res);

  if (req.method === "POST" || req.method === "PATCH") {
    const rl = await rateLimit({
      endpoint: "admin-influencer-codes",
      bucket: admin.id,
      max: 30,
      windowSec: 60,
    });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfter));
      return res.status(429).json({ error: "Demasiadas operaciones. Espera un momento." });
    }
    if (req.method === "POST") return handleCreate(req, res, admin);
    return handleToggle(req, res, admin);
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default withSentry(handler, { name: "admin-influencer-codes" });
