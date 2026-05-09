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
        height: "100dvh",
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
          Two-tab nav (Home, Agenda). Mirrors the therapist's
          BottomTabs visually but doesn't share the component —
          that one reads `screen` + `navigate` from CardiganContext,
          which the patient ctxValue intentionally doesn't include
          (the patient app uses its own local screen state since it
          has only two destinations vs. the therapist's four).
          Two tabs is small enough that inlining the markup is
          cleaner than parameterizing the shared component. */}
      <nav
        aria-label={t("patientShell.nav")}
        style={{
          flexShrink: 0,
          background: "var(--white)",
          borderTop: "1px solid var(--border-lt)",
          padding: "8px 16px calc(env(safe-area-inset-bottom, 0px) + 8px)",
          display: "flex",
          gap: 8,
        }}
      >
        {TABS.map(tab => {
          const active = screen === tab.key;
          const Icon = tab.Icon;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              className="btn-tap"
              onClick={() => {
                if (!active) { haptic.tap(); setScreen(tab.key); }
              }}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: "8px 4px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: active ? "var(--teal-dark)" : "var(--charcoal-md)",
                fontFamily: "var(--font)",
                fontSize: 11,
                fontWeight: active ? 700 : 600,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <Icon size={20} />
              <span>{t(tab.tKey)}</span>
            </button>
          );
        })}
      </nav>

      <PatientSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user}
        signOut={signOut}
      />
    </div>
  );
}
