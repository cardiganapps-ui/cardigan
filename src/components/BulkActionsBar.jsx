import { useT } from "../i18n/index";
import { IconX, IconTrash, IconCheck } from "./Icons";

/* ── BulkActionsBar ───────────────────────────────────────────────────
   Floating action bar shown above the bottom-tab nav when the user is
   in Agenda selection mode. Surfaces count + the three bulk actions
   (cancelar sin cargo, cancelar con cargo, eliminar) and an exit
   affordance.

   Pure presentation — the parent owns the selection set and the
   handlers; this component just renders + dispatches.

   Disabled-states: when count === 0 the action buttons are greyed.
   The exit (X) stays enabled regardless. */

export function BulkActionsBar({ count, onCancelNoCharge, onCancelCharge, onDelete, onExit, busy }) {
  const { t } = useT();
  const dim = count === 0 || busy;
  return (
    <div
      role="toolbar"
      aria-label={t("agenda.bulkBarAriaLabel")}
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        // Sit above the bottom-tab nav (which uses safe-area at the
        // bottom). Add the same offset so we float over it cleanly.
        paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        background: "var(--charcoal)",
        color: "var(--white)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: "var(--z-banner, 30)",
        boxShadow: "0 -6px 18px rgba(0,0,0,0.18)",
      }}
    >
      <button
        type="button"
        onClick={onExit}
        aria-label={t("close")}
        style={{
          width: 36, height: 36, borderRadius: 10, border: "none",
          background: "rgba(255,255,255,0.12)", color: "var(--white)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <IconX size={14} />
      </button>
      <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>
        {count === 0
          ? t("agenda.bulkBarHint")
          : t("agenda.bulkBarCount", { n: count })}
      </div>
      <button
        type="button"
        onClick={onCancelNoCharge}
        disabled={dim}
        style={{
          height: 36, padding: "0 12px", borderRadius: 10, border: "none",
          background: dim ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.16)",
          color: "var(--white)", fontSize: 13, fontWeight: 700,
          opacity: dim ? 0.5 : 1, cursor: dim ? "default" : "pointer",
        }}>
        {t("agenda.bulkCancelNoCharge")}
      </button>
      <button
        type="button"
        onClick={onCancelCharge}
        disabled={dim}
        style={{
          height: 36, padding: "0 12px", borderRadius: 10, border: "none",
          background: dim ? "rgba(255,255,255,0.06)" : "rgba(232,184,108,0.85)",
          color: dim ? "var(--white)" : "var(--charcoal)",
          fontSize: 13, fontWeight: 700,
          opacity: dim ? 0.5 : 1, cursor: dim ? "default" : "pointer",
        }}>
        {t("agenda.bulkCancelCharge")}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={dim}
        aria-label={t("agenda.bulkDelete")}
        style={{
          width: 36, height: 36, borderRadius: 10, border: "none",
          background: dim ? "rgba(255,255,255,0.06)" : "rgba(217,107,107,0.85)",
          color: "var(--white)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          opacity: dim ? 0.5 : 1, cursor: dim ? "default" : "pointer",
        }}>
        <IconTrash size={14} />
      </button>
    </div>
  );
}
