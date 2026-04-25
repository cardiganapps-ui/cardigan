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
                                investigating a runaway send. */

import { get as edgeGet } from "@vercel/edge-config";

const DEFAULTS = {
  cron_paused: false,
  encryption_setup_enabled: true,
  signups_paused: false,
  whatsapp_paused: false,
};

export async function getFlag(name) {
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
