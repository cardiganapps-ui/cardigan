import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import { openExternal, openExternalNewTab } from "../lib/nativeBrowser";

/* ── useTherapistConnect ──────────────────────────────────────────
   Therapist-side companion to useSubscription. Tracks the state of
   the therapist's Stripe Connect Express account (used to receive
   patient payments) and exposes the actions to start / continue
   onboarding and open the Express dashboard.

   Stripe is the source of truth: the webhook drives the DB state,
   and the GET /api/stripe-connect-status endpoint live-refreshes
   against Stripe so the UI shows the freshest state on first
   render after the therapist returns from onboarding.

   Loading shape:
     - status: 'loading' | 'absent' | 'pending' | 'restricted' | 'active'
     - exists: boolean         — has the therapist started onboarding?
     - chargesEnabled: boolean — can patients pay them right now?
     - payoutsEnabled: boolean — has Stripe verified their bank?
     - detailsSubmitted: boolean
     - requirementsCount: number — how many Stripe-side blockers remain?

   Status mapping:
     absent     — no row in therapist_connect_accounts (never started).
     pending    — row exists, details not submitted yet (mid-onboarding
                  or returned to refresh).
     restricted — submitted but Stripe is still verifying (charges
                  disabled — patients can't pay yet).
     active     — charges_enabled is true. Patients can pay. */

const ABSENT  = "absent";
const PENDING = "pending";
const RESTRICTED = "restricted";
const ACTIVE  = "active";

function deriveStatus(s) {
  if (!s || !s.exists) return ABSENT;
  if (s.charges_enabled) return ACTIVE;
  if (s.details_submitted) return RESTRICTED;
  return PENDING;
}

export function useTherapistConnect(user) {
  const [state, setState] = useState({
    status: "loading",
    exists: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirementsCount: 0,
  });
  const [busy, setBusy] = useState(false);
  // A ref keeps the latest fetch promise from clobbering newer state if
  // multiple refreshes race (e.g. tab focus + post-onboarding return).
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const myId = ++reqIdRef.current;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) return;
      const res = await fetch("/api/stripe-connect-status", {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (myId !== reqIdRef.current) return;
      setState({
        status: deriveStatus(data),
        exists: !!data.exists,
        chargesEnabled: !!data.charges_enabled,
        payoutsEnabled: !!data.payouts_enabled,
        detailsSubmitted: !!data.details_submitted,
        requirementsCount: data.requirements_count || 0,
      });
    } catch {
      if (myId !== reqIdRef.current) return;
      setState((prev) => ({ ...prev, status: prev.status === "loading" ? ABSENT : prev.status }));
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setState({
        status: "absent",
        exists: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirementsCount: 0,
      });
      return;
    }
    refresh();
  }, [user?.id, refresh]);

  // When the therapist returns from Stripe onboarding via our return
  // URL (`?stripe_connect=return`), refresh on next focus / mount so
  // the UI flips from pending → active without manual reload.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("stripe_connect")) {
      url.searchParams.delete("stripe_connect");
      window.history.replaceState({}, "", url.toString());
      refresh();
    }
  }, [refresh]);

  const startOnboarding = useCallback(async () => {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) return { ok: false, error: "no_session" };
      let res;
      try {
        res = await fetch("/api/stripe-connect-onboard", {
          method: "POST",
          headers: { Authorization: `Bearer ${access}` },
        });
      } catch (err) {
        console.error("[useTherapistConnect] onboard fetch failed:", err);
        return { ok: false, error: err?.message || "network_error" };
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        console.error("[useTherapistConnect] onboard server error:", res.status, data);
        return { ok: false, error: data.error || `http_${res.status}` };
      }
      await openExternal(data.url);
      return { ok: true };
    } catch (err) {
      console.error("[useTherapistConnect] onboard unexpected error:", err);
      return { ok: false, error: err?.message || "unknown" };
    } finally {
      setBusy(false);
    }
  }, []);  const openDashboard = useCallback(async () => {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) return { ok: false, error: "no_session" };
      let res;
      try {
        res = await fetch("/api/stripe-connect-dashboard", {
          method: "POST",
          headers: { Authorization: `Bearer ${access}` },
        });
      } catch (err) {
        console.error("[useTherapistConnect] dashboard fetch failed:", err);
        return { ok: false, error: err?.message || "network_error" };
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        console.error("[useTherapistConnect] dashboard server error:", res.status, data);
        return { ok: false, error: data.error || `http_${res.status}`, code: data.code };
      }
      // Open in a new tab on web so the therapist can flip back to
      // Cardigan — the Stripe dashboard is a multi-tab tool by nature
      // (balance, payouts, settings). Inside the native shell this
      // resolves to the Capacitor Browser sheet (single-instance),
      // which is the right native equivalent.
      await openExternalNewTab(data.url);
      return { ok: true };
    } catch (err) {
      console.error("[useTherapistConnect] dashboard unexpected error:", err);
      return { ok: false, error: err?.message || "unknown" };
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    ...state,
    busy,
    refresh,
    startOnboarding,
    openDashboard,
  };
}
