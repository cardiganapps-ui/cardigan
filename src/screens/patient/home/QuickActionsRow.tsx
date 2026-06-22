import { memo } from "react";
import { formatMXN } from "../../../utils/format";
import { IconCreditCard } from "../../../components/Icons";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed profession-theme row
type Row = any;

/* ── QuickActionsRow ──────────────────────────────────────────────
   Pill row sitting under the hero. Pagar (when balance owed). The
   reschedule action used to live here too, but it duplicated the
   "Pedir cambio de horario" button inside the next-session card
   below; reagendar is now only there. Hidden when there's no
   balance to pay. */
export const QuickActionsRow = memo(function QuickActionsRow({ theme, showPay, payAmount, onPay }: {
  theme: Row;
  showPay?: boolean;
  payAmount: number;
  onPay?: () => void;
}) {
  if (!showPay) return null;
  const pillBase: React.CSSProperties = {
    flex: 1,
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "0 16px",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-d)",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    border: "none",
    transition: "transform var(--dur-fast) var(--ease-spring)",
    WebkitTapHighlightColor: "transparent",
  };
  return (
    <div className="list-entry-stagger" style={{ display: "flex", gap: 10, "--stagger-i": 1 } as React.CSSProperties}>
      <button
        type="button"
        onClick={onPay}
        className="btn-tap"
        style={{
          ...pillBase,
          background: theme.accent,
          color: "var(--white)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <IconCreditCard size={14} />
        {`Pagar ${formatMXN(payAmount)}`}
      </button>
    </div>
  );
});
