import { useState, useEffect } from "react";
import { track as analyticsTrack } from "../lib/analytics";

/* ── useLaunchParams ───────────────────────────────────────────────────
   The three URL-param "launch intent" receivers that used to live inline
   in App.tsx's AppShell, extracted so the shell stops owning ~120 lines
   of query-string plumbing:

     1. Stripe billing return  (?billing=success|cancel&session_id=…)
     2. PWA Web Share Target   (?share_folder=1&url|text|title=…)
     3. PWA / native shortcuts (?fab=patient|session|payment, ?screen=…)

   All three share the same shape: read the param on mount, strip it from
   the URL (history.replaceState) so a refresh / screenshot can't replay
   the intent, then fire the matching side effect. The share-target and
   shortcut receivers also re-bind to popstate/pageshow because a SECOND
   intent can land while the SPA is already running (the browser changes
   the URL without remounting React).

   `shareFolderUrl` state lives here (the share receiver owns it) and is
   returned so the shell can mount the ShareFolderSheet. Everything else
   is wired through the callbacks/refs the shell passes in — guards
   (demo / read-only / unauthenticated) are preserved exactly. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface LaunchParamsDeps {
  demo?: boolean;
  readOnly?: boolean;
  user: Row;
  setScreen: (id: string) => void;
  setPendingFabAction: (fab: string) => void;
  pendingAgendaViewRef: { current: Row };
  showSuccess: (msg: string) => void;
  showToast: (msg: string, type?: string, opts?: Row) => unknown;
  t: (key: string) => string;
}

export function useLaunchParams({
  demo, readOnly, user,
  setScreen, setPendingFabAction, pendingAgendaViewRef,
  showSuccess, showToast, t,
}: LaunchParamsDeps) {
  // Web Share Target receiver state. When the user shares a folder
  // URL into Cardigan from the OS share sheet, the browser routes
  // to /?share_folder=1&url=…&text=…&title=… — we capture the URL
  // here and open the ShareFolderSheet patient picker.
  const [shareFolderUrl, setShareFolderUrl] = useState<string | null>(null);

  // ── Stripe billing return (?billing=success|cancel) ──
  // After Checkout the user is redirected back with ?billing=… — strip
  // it (so a refresh doesn't re-fire), broadcast a window event so
  // useSubscription can refetch the row, and surface a one-shot toast on
  // success. The webhook usually beats the redirect, but we delay the
  // refetch inside useSubscription as a fallback.
  useEffect(() => {
    if (demo) return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    params.delete("billing");
    params.delete("session_id");
    const newUrl = window.location.pathname
      + (params.toString() ? `?${params.toString()}` : "")
      + window.location.hash;
    window.history.replaceState({}, "", newUrl);
    window.dispatchEvent(new CustomEvent("cardigan-billing-return", { detail: { billing } }));
    if (billing === "success") {
      showSuccess(t("subscription.toastSubscribed"));
      analyticsTrack("subscribe_success", { source: "stripe_return" });
    } else if (billing === "cancel") {
      analyticsTrack("checkout_cancelled");
    }
  // showSuccess / t are stable by useCallback / context — only run on
  // first mount when the URL still has the billing param.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── PWA Web Share Target receiver ──
  // The manifest registers /?share_folder=1 as the action for shared
  // folder URLs. iOS / Android route the OS share sheet here when
  // the user picks Cardigan from a Drive/OneDrive/etc folder share.
  // Different platforms bundle the shared content into different
  // params (Android: url; iOS: text/title; macOS: title+url) — we
  // pull whichever is present and open the picker.
  //
  // The handler is wrapped in a callable so it can also fire on
  // popstate / focus / pageshow events. Without that, a SECOND
  // share-target invocation while the SPA is already running
  // (browser changes the URL but doesn't remount React) wouldn't
  // re-trigger the sheet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleShareIntent = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("share_folder") !== "1") return;
      const candidate = params.get("url")
        || params.get("text")
        || params.get("title")
        || "";
      // Strip the share_folder bookkeeping from the URL FIRST,
      // unconditionally. Demo / read-only / unauthenticated users
      // should never have stale share params clinging to the URL —
      // a later toggle of those flags would re-fire on a clean
      // mount and surprise the user.
      params.delete("share_folder");
      params.delete("url");
      params.delete("text");
      params.delete("title");
      const newUrl = window.location.pathname
        + (params.toString() ? `?${params.toString()}` : "")
        + window.location.hash;
      window.history.replaceState({}, "", newUrl);
      // Now decide what to do with the candidate:
      //   - demo / read-only: a friendly toast; can't link in those
      //     states, but the user deserves an explanation.
      //   - not signed in: nothing to do; the auth flow takes over
      //     and the share intent is dropped (rare — the OS share
      //     sheet only routes to Cardigan for authenticated users
      //     who installed the PWA).
      //   - empty candidate (rare; user shared a non-URL like a
      //     plain note via the OS share sheet): friendly toast.
      //   - everything else: open the picker.
      if (!user) return;
      if (demo || readOnly) {
        showToast(t("expediente.folder.shareUnavailable"), "info");
        return;
      }
      if (!candidate.trim()) {
        showToast(t("expediente.folder.shareEmpty"), "warning");
        return;
      }
      setShareFolderUrl(candidate);
    };

    // Run on mount.
    handleShareIntent();
    // Re-run when the URL changes within the same SPA instance
    // (Android Chrome reuses the running tab on a second share).
    window.addEventListener("popstate", handleShareIntent);
    // pageshow fires when the PWA is foregrounded (incl. cold
    // restart on iOS) — covers the case where iOS suspends the
    // app and a new share lands while it was backgrounded.
    window.addEventListener("pageshow", handleShareIntent);
    return () => {
      window.removeEventListener("popstate", handleShareIntent);
      window.removeEventListener("pageshow", handleShareIntent);
    };
  // demo / readOnly / user can change at runtime; re-bind the
  // listener so the latest values are captured in the closure.
  // showToast / t are stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, demo, readOnly]);

  // ── PWA / native app shortcuts receiver ──
  // The web app manifest's `shortcuts` array (public/manifest.json)
  // and the Android AndroidManifest.xml's <shortcut> entries both
  // launch the app at /?fab=patient|session|payment (or /?screen=…
  // for nav-only shortcuts). This effect drains those params on
  // mount, fires the matching action, and strips them from the URL
  // so a refresh / screenshot doesn't replay the shortcut.
  //
  // Read-only / demo / unauth users have the params stripped but the
  // action no-ops downstream (requestFabAction / setScreen are
  // safe-by-default in those modes). Stripping happens unconditionally
  // so a later state flip doesn't surprise the user with a stale intent.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fab = params.get("fab");
    const target = params.get("screen");
    if (!fab && !target) return;
    params.delete("fab");
    params.delete("screen");
    const newUrl = window.location.pathname
      + (params.toString() ? `?${params.toString()}` : "")
      + window.location.hash;
    window.history.replaceState({}, "", newUrl);
    if (target && typeof target === "string") {
      // For the "Hoy" shortcut (target=agenda), nudge the agenda's
      // pending view ref to "day" so the user lands on the day strip
      // showing today's sessions even if their last visit left them
      // in week/month view. Agenda's consumeAgendaView() drains it
      // on mount.
      if (target === "agenda") pendingAgendaViewRef.current = "day";
      setScreen(target);
    }
    if (fab && typeof fab === "string") {
      // requestFabAction is the same coordinator the FAB itself uses;
      // QuickActions watches pendingFabAction and opens the matching
      // sheet (patient, session, payment, note, document). Routing
      // through it instead of opening a sheet directly keeps the
      // entry-point logic in one place and respects the existing
      // pro-gate / readOnly checks downstream.
      setPendingFabAction(fab);
    }
  // First mount only — the URL params are drained immediately and a
  // navigation away rewrites window.location, so re-running would
  // either find an empty URL (no-op) or re-fire a stale intent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { shareFolderUrl, setShareFolderUrl };
}
