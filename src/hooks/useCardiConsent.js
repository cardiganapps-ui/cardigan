import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/* ── useCardiConsent ──────────────────────────────────────────────────
   Tracks whether the user has accepted the Cardi data-access consent
   (separate from the global LFPDPPP privacy policy in ConsentBanner).
   This is the gate the user crosses before patient data, sessions,
   payments, and balances flow through Cardi to Anthropic.

   Stored in:
     - localStorage (`cardigan.cardi.consent.v`) for fast UX
     - public.user_consents with policy_version="cardi-data-v1" for
       audit (LFPDPPP requirement)

   Same lookup pattern as ConsentBanner — local cache hit short-
   circuits, miss falls back to a server check before assuming
   "not consented" (so a new device / cleared storage doesn't re-
   prompt a user who already accepted on another device). */

export const CARDI_POLICY_VERSION = "cardi-data-v1";
const LS_KEY = "cardigan.cardi.consent.v";

export function useCardiConsent({ user, enabled }) {
  // Three-state: unknown / accepted / not-accepted.
  const [state, setState] = useState("unknown");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !user) { setState("unknown"); return; }

    let cancelled = false;
    let stored = null;
    try { stored = localStorage.getItem(LS_KEY); } catch { /* blocked */ }
    if (stored === CARDI_POLICY_VERSION) {
      setState("accepted");
      return;
    }

    (async () => {
      try {
        const { data, error: qErr } = await supabase
          .from("user_consents")
          .select("policy_version")
          .eq("user_id", user.id)
          .eq("policy_version", CARDI_POLICY_VERSION)
          .maybeSingle();
        if (cancelled) return;
        if (!qErr && data?.policy_version === CARDI_POLICY_VERSION) {
          try { localStorage.setItem(LS_KEY, CARDI_POLICY_VERSION); } catch { /* ignore */ }
          setState("accepted");
        } else {
          setState("not_accepted");
        }
      } catch {
        // Conservative: if we can't confirm, surface the gate rather
        // than silently sending data without explicit consent.
        if (!cancelled) setState("not_accepted");
      }
    })();
    return () => { cancelled = true; };
  }, [user, enabled]);

  const accept = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("auth");
        return;
      }
      const res = await fetch("/api/record-consent", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ policy_version: CARDI_POLICY_VERSION }),
      });
      if (!res.ok) {
        setError("server");
        return;
      }
      try { localStorage.setItem(LS_KEY, CARDI_POLICY_VERSION); } catch { /* ignore */ }
      setState("accepted");
    } catch {
      setError("network");
    } finally {
      setSubmitting(false);
    }
  }, [submitting]);

  return { state, accept, submitting, error };
}
