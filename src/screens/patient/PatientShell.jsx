import { useState } from "react";
import { useT } from "../../i18n/index";
import { LogoIcon } from "../../components/LogoMark";
import { AvatarContent } from "../../components/Avatar";
import { IconSettings, IconHome, IconCalendar } from "../../components/Icons";
import { PullToRefresh } from "../../components/PullToRefresh";
import { PatientHome } from "./PatientHome";
import { PatientAgenda } from "./PatientAgenda";
import { PatientSettingsSheet } from "./PatientSettingsSheet";
import { haptic } from "../../utils/haptics";

/* ── PatientShell ─────────────────────────────────────────────────
   Patient-side app shell. Smaller than the therapist shell — no
   FAB, no admin chrome, no drawer with five sections. The patient
   is here to glance at their next session, see their schedule, and
   leave.

   Two screens, both reached via bottom tabs:
     - Inicio: hero (next session) + balance + therapist + docs
     - Agenda: día / semana / mes views over the patient's sessions
   Both share the same data prop (sessions + therapist + balance);
   neither mutates anything except via the cancel/reschedule
   endpoints which are scoped to the patient's own sessions.

   Read-only by definition — patients can't write any data in v1
   beyond the cancel/reschedule request flows.

   Top bar: logo + a small avatar that opens the settings sheet
   (notifications, calendar feed, sign out). */

const TABS = [
  { key: "home",   Icon: IconHome,     tKey: "patientShell.tabHome" },
  { key: "agenda", Icon: IconCalendar, tKey: "patientShell.tabAgenda" },
];

export function PatientShell({ user, signOut, data }) {
  const { t } = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [screen, setScreen] = useState("home");

  // Sliding active-tab indicator — parity with the therapist BottomTabs.
  // --active-i drives the capsule's translateX; the pill's overflow:hidden
  // clips the spring overshoot, so no edge special-casing is needed.
  const activeIndex = TABS.findIndex(tab => tab.key === screen);

  // Patient display name — sourced in priority order:
  //   1. The therapist's record of the patient (patients.name) —
  //      most reliable since the therapist knew them by that name
  //      before they ever touched Cardigan.
  //   2. Supabase user_metadata.full_name (if the auth signup
  //      collected it; today it doesn't, but future flows might).
  //   3. The email local part.
  // The avatar uses initials from the same priority chain.
  const patientName = data.primaryPatient?.name
    || user?.user_metadata?.full_name
    || user?.email?.split("@")[0]
    || "";
  const patientInitials = (
    patientName.split(/\s+/).map(s => s[0] || "").join("").slice(0, 2)
    || user?.email?.slice(0, 2)
    || "?"
  ).toUpperCase();

  return (
    <div
      style={{
        // Fixed height (not minHeight) so the inner scroll region
        // owns overflow. Global `html, body { overflow: hidden }`
        // means the page itself never scrolls — every screen has to
        // manage its own scrollable container, same pattern the
        // therapist .shell + .main-content classes use.
        //
        // `100%` — NOT `100dvh`. iOS WKWebView/standalone underreport
        // `100dvh` when env(safe-area-inset-bottom) is present, so this
        // overflow:hidden box ended SHORT of the visible viewport and
        // clipped the inner scroll content at a line above the true
        // bottom, while the position:fixed .bottom-tabs anchored to the
        // real viewport and floated below the clip — the same "dead
        // band" the therapist .shell had. `100%` resolves against the
        // already-correct #root height:100% chain (the visible
        // viewport / ICB the fixed bar uses). Do NOT use a viewport unit.
        height: "100%",
        background: "var(--white)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          background: "var(--white)",
          borderBottom: "1px solid var(--border-lt)",
          padding: "calc(var(--sat, 0px) + 14px) 16px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <LogoIcon size={22} color="var(--teal)" />
        <span
          style={{
            fontFamily: "var(--font-d)",
            fontWeight: 800,
            fontSize: 16,
            color: "var(--charcoal)",
            letterSpacing: "-0.2px",
          }}
        >
          cardigan
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t("patientShell.openSettings")}
          className="btn-tap"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 4,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--teal-pale)",
              color: "var(--teal-dark)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            <AvatarContent initials={patientInitials} />
          </div>
          <IconSettings size={14} style={{ color: "var(--charcoal-xl)" }} />
        </button>
      </div>

      {/* ── Body — scroll-owner. flex:1 fills the remaining height
            below the top bar. PullToRefresh wraps the scroll surface
            and looks for .scroll-bounce to detect scrollTop, so the
            swipe-down gesture re-fetches data without leaving the
            screen. The scroll container is keyed on `screen` so
            switching tabs resets scroll-to-top — otherwise the user
            would land halfway down the agenda's month view after
            scrolling Home, which is disorienting. */}
      <PullToRefresh onRefresh={data.refresh}>
        <div
          key={screen}
          className="scroll-bounce"
          style={{
            flex: 1,
            minHeight: 0,
            paddingBottom: "max(80px, calc(env(safe-area-inset-bottom) + 64px))",
          }}
        >
          {screen === "home" && <PatientHome data={data} user={user} />}
          {screen === "agenda" && <PatientAgenda data={data} />}
        </div>
      </PullToRefresh>

      {/* ── Bottom tabs ──
          Reuses the therapist's `.bottom-tabs` classes so we get the
          same visual treatment AND inherit the body:has(.sheet-overlay)
          auto-hide rule (sheets cover the entire viewport — when one
          is open, the tab bar would otherwise bleed through over the
          scrim). The therapist's BottomTabs component reads from
          CardiganContext (screen + navigate); the patient's local
          screen state means inlining the markup is cleaner than
          parameterizing. */}
      <nav
        className="bottom-tabs"
        role="tablist"
        aria-label={t("patientShell.nav")}
        style={{ "--active-i": activeIndex, "--tab-count": TABS.length }}
      >
        {activeIndex >= 0 && <span className="bottom-tab-indicator" aria-hidden="true" />}
        {TABS.map(tab => {
          const active = screen === tab.key;
          const Icon = tab.Icon;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`bottom-tab ${active ? "bottom-tab--active" : ""}`}
              onClick={() => {
                if (!active) { haptic.tap(); setScreen(tab.key); }
              }}
            >
              <span className="bottom-tab-icon"><Icon size={22} /></span>
              <span className="bottom-tab-label">{t(tab.tKey)}</span>
            </button>
          );
        })}
      </nav>
      {/* iOS PWA home-indicator safe-area fill — same trick the
          therapist BottomTabs uses. */}
      <div className="bottom-tabs-safezone" aria-hidden="true" />

      <PatientSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user}
        signOut={signOut}
      />
    </div>
  );
}
