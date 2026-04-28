import { useState } from "react";
import { supabase } from "../supabaseClient";
import { IconCalendar } from "./Icons";
import { useT } from "../i18n/index";
import { useCardigan } from "../context/CardiganContext";
import { useCalendarToken, setCalendarToken } from "../hooks/useCalendarToken";

/* Calendar feed link UI — used inline in Settings and inside the
   CalendarLinkSheet that's opened from the Agenda screen. Reads token
   state from the shared `useCalendarToken` hook so the Agenda CTA can
   hide itself once the user has linked their calendar.

   Three states:
     1. !hasToken             → "Activar calendario" CTA.
     2. hasToken && !url      → returning visit. Show prefix + creation
                                 date + a "Regenerar enlace" button. The
                                 plaintext URL isn't recoverable from the
                                 server (DB only stores the SHA-256 hash
                                 — see migration 026), so to copy it
                                 again the user must rotate (which breaks
                                 existing subscribers).
     3. hasToken &&  url      → just rotated. Show the URL + platform
                                 subscribe pills + copy. This is the
                                 ONLY chance to grab the URL until the
                                 next rotation.

   The user can renew at any time from the "Renovar enlace" button in
   state 2 — that flow rotates the token (breaks existing subscribers
   by design) and surfaces the new URL once. */

export function CalendarLinkPanel({ readOnly = false }) {
  const { t } = useT();
  const { showToast } = useCardigan();
  const { hasToken, url } = useCalendarToken();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const callCalendarToken = async (method) => {
    if (busy) return null;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) { showToast(t("settings.calendarError"), "error"); return null; }
      const res = await fetch("/api/calendar-token", {
        method,
        headers: { "Authorization": `Bearer ${access}` },
      });
      if (!res.ok) { showToast(t("settings.calendarError"), "error"); return null; }
      return await res.json();
    } catch {
      showToast(t("settings.calendarError"), "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    const j = await callCalendarToken("POST");
    if (!j) return;
    setCalendarToken(j);
    setManualOpen(true);          // surface the URL block immediately
    showToast(t("settings.calendarEnabled"), "success");
  };

  const rotate = async () => {
    if (!confirm(t("settings.calendarRotateConfirm"))) return;
    const j = await callCalendarToken("POST");
    if (!j) return;
    setCalendarToken(j);
    setManualOpen(true);
    showToast(t("settings.calendarRotated"), "success");
  };

  const copyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast(t("settings.calendarCopyError"), "error");
    }
  };

  // ── State 1: not enabled ──
  if (!hasToken) {
    return (
      <>
        <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:12 }}>
          <div style={{ color:"var(--teal-dark)", marginTop:2 }}><IconCalendar size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title" style={{ marginBottom:4 }}>{t("settings.calendarTitle")}</div>
            <div className="settings-row-sub" style={{ lineHeight:1.5 }}>{t("settings.calendarDescription")}</div>
          </div>
        </div>
        <button className="btn btn-primary" type="button" onClick={enable} disabled={busy || readOnly}>
          {busy ? t("loading") : t("settings.calendarEnable")}
        </button>
      </>
    );
  }

  // ── State 2: enabled, but plaintext URL not in memory (returning visit) ──
  // Minimal card: title + "Sincronizado" sub + one ghost button to
  // renew. The DB only holds the SHA-256 hash so we literally can't
  // re-display the URL — but the user doesn't need to know that.
  // "Renovar enlace" is enough; the rotate-confirm dialog explains
  // that existing subscribers will stop receiving updates.
  if (!url) {
    return (
      <>
        <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:14 }}>
          <div style={{ color:"var(--teal-dark)", marginTop:2 }}><IconCalendar size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.calendarTitle")}</div>
            <div className="settings-row-sub" style={{ lineHeight:1.5 }}>
              {t("settings.calendarActive")}
            </div>
          </div>
        </div>
        <button className="btn btn-ghost" type="button" onClick={rotate} disabled={busy || readOnly} style={{ width:"100%" }}>
          {busy ? t("loading") : t("settings.calendarRenew")}
        </button>
      </>
    );
  }

  // ── State 3: just enabled / rotated — display the URL ──
  // Build platform-specific subscribe URLs from the canonical https feed.
  // webcal:// is the universal "subscribe" scheme both Apple Calendar
  // (iOS + macOS) and most desktop clients accept; tapping the link
  // prompts the native app to add the feed. Google Calendar's add-by-URL
  // flow expects the same webcal URL, URL-encoded into the cid param.
  const webcalUrl = url.replace(/^https?:\/\//, "webcal://");
  const googleAddUrl = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(webcalUrl)}`;
  const pillStyle = {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    textDecoration: "none",
    height: 36,
    padding: "0 8px",
    fontSize: 13,
    minWidth: 0,
  };

  return (
    <>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:14 }}>
        <div style={{ color:"var(--teal-dark)", marginTop:2 }}><IconCalendar size={18} /></div>
        <div style={{ flex:1 }}>
          <div className="settings-row-title">{t("settings.calendarTitle")}</div>
          <div className="settings-row-sub" style={{ lineHeight:1.5 }}>{t("settings.calendarHint")}</div>
        </div>
      </div>

      <div style={{ background:"var(--teal-pale)", color:"var(--teal-dark)", padding:"10px 12px", borderRadius:"var(--radius)", fontSize:12, lineHeight:1.5, marginBottom:12 }}>
        {t("settings.calendarUrlDisplayOnce")}
      </div>

      {/* Three subscribe options on a single row — equal-flex
          btn-teal-soft pills with shorter labels so they fit on a 320px
          screen. The "Otras" pill toggles the manual-URL block below. */}
      <div style={{ display:"flex", gap:8, marginBottom: manualOpen ? 12 : 0 }}>
        <a href={webcalUrl} className="btn btn-teal-soft" style={pillStyle} aria-label={t("settings.calendarAddApple")}>
          <svg width="14" height="14" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
            <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM275.8 91.4c20.6-24.4 18.8-46.6 18.2-54.6-18.4 1.1-39.6 12.5-51.7 26.5-13.3 15-21.1 33.5-19.4 53.1 19.9 1.5 37.9-8.8 52.9-25z" />
          </svg>
          <span>Apple</span>
        </a>
        <a href={googleAddUrl} target="_blank" rel="noopener noreferrer" className="btn btn-teal-soft" style={pillStyle} aria-label={t("settings.calendarAddGoogle")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3.5-7.13" />
            <path d="M21 12h-7" />
          </svg>
          <span>Google</span>
        </a>
        <button
          type="button"
          onClick={() => setManualOpen(v => !v)}
          className="btn btn-teal-soft"
          style={pillStyle}
          aria-expanded={manualOpen}
          aria-label={t("settings.calendarMoreOptions")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" fill="currentColor" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <circle cx="19" cy="12" r="1.6" fill="currentColor" />
          </svg>
          <span>Otras</span>
        </button>
      </div>

      {manualOpen && (
        <div>
          <div style={{ fontSize:12, color:"var(--charcoal-md)", marginBottom:8, lineHeight:1.5 }}>
            {t("settings.calendarManualHint")}
          </div>
          <div
            style={{
              background:"var(--teal-pale)",
              color:"var(--teal-dark)",
              fontFamily:"var(--font-mono, monospace)",
              fontSize:12,
              padding:"10px 12px",
              borderRadius:"var(--radius)",
              wordBreak:"break-all",
              marginBottom:8,
              userSelect:"all",
            }}
            aria-label="Calendar feed URL"
          >
            {url}
          </div>
          <button className="btn btn-ghost" type="button" onClick={copyUrl} disabled={busy} style={{ width:"100%" }}>
            {copied ? t("settings.calendarCopied") : t("settings.calendarCopy")}
          </button>
        </div>
      )}
    </>
  );
}
