import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { IconCalendar, IconX } from "./Icons";
import { useT } from "../i18n/index";
import { useCardigan } from "../context/CardiganContext";
import { useCalendarToken, setCalendarToken, isCalendarPromptDismissed, dismissCalendarPrompt } from "../hooks/useCalendarToken";
import { track } from "../lib/analytics";

/* ── CalendarLinkPromptCard ──────────────────────────────────────────
   Inline Home card that nudges the user to subscribe their
   Apple/Google calendar to Cardigan's iCal feed once they've added
   their first patient or first session. The full management UI lives
   in Settings → Calendario; this card is the discovery surface that
   most users would never find otherwise.

   Two states:
     1. Pre-link: title + body + "Activar" CTA. Hits POST
        /api/calendar-token to mint a token, then transitions to (2).
     2. Just linked (hasToken && url): inline Apple / Google pills
        + a small "Listo" hint. State 2 in CalendarLinkPanel matches
        this; we reuse the same webcal:// + Google add-by-cid URLs.

   Hidden silently when:
     - readOnly (admin "view as user" / trial-expired)
     - already linked (hasToken && !url) — Settings shows the UI
     - dismissed via the userId-scoped localStorage flag
     - user has zero patients AND zero sessions (parent gates this) */


export function CalendarLinkPromptCard() {
  const { t } = useT();
  const { showToast, readOnly, user } = useCardigan();
  const { hasToken, url, loaded } = useCalendarToken();
  const [hidden, setHidden] = useState(() => isCalendarPromptDismissed(user?.id));
  const [busy, setBusy] = useState(false);
  // Synchronous guard against rapid double-clicks. React state lags
  // a render cycle behind, so the closure that fires from a quick
  // second tap may still see busy=false. The ref is updated in the
  // same tick so the second handler exits immediately.
  const inFlightRef = useRef(false);
  // True only during the brief window after the user just enabled
  // — the Calendar panel's "state 3" copy applies until they reload
  // (the plaintext URL only lives in memory, never on the server).
  const [justEnabled, setJustEnabled] = useState(false);

  // Fire `calendar_prompt_shown` once per mount when the card is
  // actually visible (the card has multiple gates above the render).
  const trackedRef = useRef(false);

  // ── Visibility gates ──
  // Hide if read-only, the user dismissed, or while we're still
  // figuring out whether they already have a token (avoid flashing
  // the card before useCalendarToken's first GET resolves).
  // If the user already has a token and it's NOT the just-enabled
  // window (no plaintext URL in memory), the panel in Settings is
  // the right place to manage it — silently no-op here.
  const visible = !readOnly && !hidden && loaded && !(hasToken && !url && !justEnabled);

  // Trigger the analytics event the first time this mount becomes
  // user-visible. Fires only once even if the card re-renders. MUST
  // sit above the early-return so the rules-of-hooks hold.
  useEffect(() => {
    if (visible && !trackedRef.current) {
      trackedRef.current = true;
      track("calendar_prompt_shown");
    }
  }, [visible]);

  if (!visible) return null;

  const enable = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) {
        showToast(t("settings.calendarError"), "error");
        return;
      }
      const res = await fetch("/api/calendar-token", {
        method: "POST",
        headers: { "Authorization": `Bearer ${access}` },
      });
      if (!res.ok) {
        showToast(t("settings.calendarError"), "error");
        return;
      }
      const j = await res.json();
      setCalendarToken(j);
      setJustEnabled(true);
      track("calendar_prompt_enabled");
      // No toast — `justEnabled` rerenders the card into its success
      // state with the URL block visible, which is the confirmation.
    } catch {
      showToast(t("settings.calendarError"), "error");
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    dismissCalendarPrompt(user?.id);
    setHidden(true);
    track("calendar_prompt_dismissed");
  };

  // Build platform subscribe links — webcal:// is the universal
  // "subscribe" scheme both Apple Calendar and most desktop clients
  // accept; Google Calendar's add-by-URL form expects the same URL
  // URL-encoded into the cid param. Mirrors CalendarLinkPanel state 3.
  const webcalUrl = url ? url.replace(/^https?:\/\//, "webcal://") : "";
  const googleAddUrl = url
    ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(webcalUrl)}`
    : "";

  return (
    <div
      role="region"
      aria-label={t("calendarPrompt.title")}
      style={{
        margin: "12px 16px 0",
        padding: "14px",
        background: "var(--teal-pale)",
        border: "1px solid var(--teal-mist)",
        borderRadius: "var(--radius)",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        animation: "fadeIn 0.25s ease",
      }}>
      <div style={{
        flexShrink: 0,
        width: 36, height: 36,
        borderRadius: "50%",
        background: "var(--teal)",
        color: "var(--white)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <IconCalendar size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: "var(--text-md)", color: "var(--charcoal)" }}>
          {justEnabled ? t("calendarPrompt.titleSubscribe") : t("calendarPrompt.title")}
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", marginTop: 3, lineHeight: 1.35 }}>
          {justEnabled ? t("calendarPrompt.bodySubscribe") : t("calendarPrompt.body")}
        </div>
        {justEnabled && url ? (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <a
              href={webcalUrl}
              className="btn btn-teal-soft"
              onClick={() => track("calendar_prompt_subscribe", { channel: "apple" })}
              style={{ flex: 1, height: 36, padding: "0 8px", fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, textDecoration: "none" }}
              aria-label={t("settings.calendarAddApple")}>
              <svg width="14" height="14" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
                <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM275.8 91.4c20.6-24.4 18.8-46.6 18.2-54.6-18.4 1.1-39.6 12.5-51.7 26.5-13.3 15-21.1 33.5-19.4 53.1 19.9 1.5 37.9-8.8 52.9-25z" />
              </svg>
              <span>Apple</span>
            </a>
            <a
              href={googleAddUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("calendar_prompt_subscribe", { channel: "google" })}
              className="btn btn-teal-soft"
              style={{ flex: 1, height: 36, padding: "0 8px", fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, textDecoration: "none" }}
              aria-label={t("settings.calendarAddGoogle")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-3.5-7.13" />
                <path d="M21 12h-7" />
              </svg>
              <span>Google</span>
            </a>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-teal"
              onClick={enable}
              disabled={busy}
              style={{
                height: 34, padding: "0 14px",
                fontSize: "var(--text-sm)",
                width: "auto", minHeight: 0,
                display: "inline-flex", alignItems: "center", gap: 6,
                opacity: busy ? 0.85 : 1,
              }}>
              {busy && (
                <span
                  aria-hidden="true"
                  style={{
                    width: 12, height: 12, borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.45)",
                    borderTopColor: "var(--white)",
                    animation: "togglePendingSpin 0.7s linear infinite",
                    boxSizing: "border-box",
                  }}
                />
              )}
              {t("calendarPrompt.cta")}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              style={{
                height: 34, padding: "0 12px", fontSize: "var(--text-sm)", fontWeight: 600,
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--charcoal-md)", fontFamily: "var(--font)",
              }}>
              {t("calendarPrompt.dismiss")}
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={t("calendarPrompt.dismiss")}
        onClick={handleDismiss}
        style={{
          flexShrink: 0,
          width: 36, height: 36,
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--charcoal-xl)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginRight: -8, marginTop: -8,
        }}>
        <IconX size={14} />
      </button>
    </div>
  );
}
