import { useState } from "react";
import { useT } from "../../i18n/index";
import { LogoIcon } from "../../components/LogoMark";
import { AvatarContent } from "../../components/Avatar";
import { IconSettings } from "../../components/Icons";
import { PatientHome } from "./PatientHome";
import { PatientSettingsSheet } from "./PatientSettingsSheet";

/* ── PatientShell ─────────────────────────────────────────────────
   Patient-side app shell. Dramatically smaller than the therapist
   shell — no FAB, no bottom tabs, no admin chrome, no drawer with
   five sections. The patient is here to glance at their schedule
   + balance and leave.

   Top bar: logo + a small avatar that opens a tiny menu (Cerrar
   sesión for v1; future iterations add Mi cuenta + Cambiar
   profesionista). The body is a single scrollable column rendered
   by PatientHome.

   Read-only by definition — patients can't write any data in v1.
   No mutating calls anywhere downstream. */

export function PatientShell({ user, signOut, data }) {
  const { t } = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        {/* Avatar tap → opens the settings sheet directly. The
            old dropdown menu had a single item (sign out); after
            the settings sheet absorbed sign out + notifications +
            calendar, the dropdown stopped earning its keep. */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t("patientShell.openSettings")}
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
            below the top bar; overflow-y:auto lets content scroll
            inside this container while the rest of the page stays
            put. Bottom padding accounts for the iOS home indicator
            (env(safe-area-inset-bottom)) so the last card never sits
            under the gesture area. -webkit-overflow-scrolling=touch
            and overscroll-behavior=contain match the therapist-side
            scrollable surfaces. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorY: "contain",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        }}
      >
        <PatientHome data={data} user={user} />
      </div>

      <PatientSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user}
        signOut={signOut}
      />
    </div>
  );
}
