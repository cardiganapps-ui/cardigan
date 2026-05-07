import { useState } from "react";
import { useT } from "../../i18n/index";
import { LogoIcon } from "../../components/LogoMark";
import { AvatarContent } from "../../components/Avatar";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { IconLogOut, IconChevron } from "../../components/Icons";
import { PatientHome } from "./PatientHome";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

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
        minHeight: "100dvh",
        background: "var(--cream)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          background: "var(--white)",
          borderBottom: "1px solid var(--border-lt)",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          position: "sticky",
          top: 0,
          zIndex: 5,
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
          onClick={() => setMenuOpen(v => !v)}
          aria-label={t("patientShell.menu")}
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
          <IconChevron size={12} />
        </button>
      </div>

      {/* ── Tiny dropdown menu — sign out only in v1 ── */}
      {menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9,
              background: "transparent",
            }}
          />
          <div
            role="menu"
            style={{
              position: "fixed",
              top: 60,
              right: 16,
              zIndex: 10,
              background: "var(--white)",
              border: "1px solid var(--border-lt)",
              borderRadius: "var(--radius)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
              padding: 4,
              minWidth: 180,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setConfirmSignOut(true);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "10px 12px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font)",
                fontSize: 14,
                color: "var(--charcoal)",
                textAlign: "left",
                borderRadius: "var(--radius)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <IconLogOut size={16} /> {t("nav.signOut")}
            </button>
          </div>
        </>
      )}

      {/* ── Body ── */}
      <PatientHome data={data} user={user} />

      <ConfirmDialog
        open={confirmSignOut}
        title={t("nav.signOut")}
        body={t("nav.signOutConfirm")}
        confirmLabel={t("nav.signOut")}
        destructive
        onConfirm={() => {
          setConfirmSignOut(false);
          signOut?.();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}
