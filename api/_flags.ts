/* ── Edge Config feature flags / kill switches ──────────────────────
   Centralised reader for the few global flags Cardigan keeps in Edge
   Config. Each flag's *purpose* is documented inline so future
   readers don't have to spelunk the dashboard to know what flipping
   one does.

   All reads are non-throwing — if the Edge Config service is briefly
   unavailable, we fall back to the documented default rather than
   crash a request. Edge Config is replicated globally with ~15ms
   reads, so this safety net is mostly insurance.

   Flags currently defined:
     cron_paused              — when true, /api/send-session-reminders
                                returns 200 with sent:0 and does no
                                work. Use during a push-notification
                                outage or while debugging duplicate
                                sends.
     encryption_setup_enabled — when false, /api/encryption rejects
                                new POST setups with 503. Use to
                                pause the encryption rollout if a
                                bug surfaces mid-deploy. Existing
                                users with encryption enabled are
                                unaffected.
     signups_paused           — informational for now; the AuthScreen
                                doesn't read it yet (Supabase handles
                                signup directly). Wire when needed.
     whatsapp_paused          — when true, the WhatsApp branch of
                                /api/send-session-reminders no-ops.
                                Web push reminders continue. Use
                                during a Meta Cloud API outage, a
                                template-approval issue, or while
                                investigating a runaway send.
     cardi_paused             — when true, /api/cardi-ask returns
                                503 and the in-app chat surfaces a
                                "pausado" banner. Use during an
                                Anthropic outage, a runaway-cost
                                incident, or to pull the feature
                                instantly without a redeploy.
     lifecycle_extra_paused   — when true, the engagement-program
                                cohorts (referral_nudge_*, rating_*)
                                are skipped. Existing trial cohorts
                                (trial_day_*, trial_winback_*) keep
                                running. Lets us silence the new
                                program independently in an incident.
     ocr_paused               — when true, /api/ocr-receipt returns
                                503 and the ExpenseSheet's auto-fill
                                silently falls back to manual entry
                                (the receipt itself still attaches).
                                Use during an Anthropic outage or a
                                runaway-cost incident on receipt
                                processing. */

import { get as edgeGet } from "@vercel/edge-config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const DEFAULTS: Row = {
  cron_paused: false,
  encryption_setup_enabled: true,
  signups_paused: false,
  whatsapp_paused: false,
  cardi_paused: false,
  lifecycle_extra_paused: false,
  ocr_paused: false,
};

export async function getFlag(name: string): Promise<Row> {
  if (!(name in DEFAULTS)) {
    throw new Error(`Unknown flag: ${name}`);
  }
  // No EDGE_CONFIG env in dev / preview without the connection string
  // → straight to default. No surprise 500s in local development.
  if (!process.env.EDGE_CONFIG) return DEFAULTS[name];
  try {
    const v = await edgeGet(name);
    return v === undefined ? DEFAULTS[name] : v;
  } catch {
    return DEFAULTS[name];
  }
}
