import React from "react";
import { Avatar } from "../../components/Avatar";
import { SwipeRevealRow } from "../../components/SwipeRevealRow";
import { IconDollar } from "../../components/Icons";
import { useLongPress } from "../../hooks/useLongPress";
import { getClientColor } from "../../data/seedData";
import { formatMXN } from "../../utils/format";

// Loosely-typed patient/session rows flow through the Cardigan data layer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration bridge for loosely-typed rows
type Row = any;

/* ── PatientRow ──
   Extracted from the .map() inside the main Patients render so per-row hooks
   (useLongPress) have a stable owner. Wraps the row body in a long-press
   detector that opens the same context menu desktop users get via
   right-click — surfacing Editar / Eliminar on mobile, where neither
   swipe-to-pay nor the chevron tap currently exposes them.

   The long-press handlers sit on a wrapping div around SwipeRevealRow (or the
   bare row). Both gesture systems get the raw touch events because neither
   stops propagation; SwipeRevealRow bails out the moment vertical motion
   dominates, while long-press bails out the moment ANY motion exceeds 10px. A
   still hold-for-450ms triggers the menu, suppressing the synthetic click
   that would otherwise reach the row's onClick.

   Moved to its own file in WS-6 (it was the only in-file component the patient
   list rendered); the .map() call site in Patients.tsx is unchanged. */
export type PatientRowProps = {
  p: Row;
  i: number;
  swipeEnabled: boolean;
  isInterviewLane: boolean;
  isPotential: boolean;
  isDiscarded: boolean;
  filter: string;
  splitMode: boolean;
  expediente: Row | null;
  rowClick: () => void;
  openCtxMenu: ((x: number, y: number, p: Row, e?: Row) => void) | null;
  onPay: (p: Row) => void;
  t: (key: string, ...args: Row[]) => string;
};

export function PatientRow({ p, i, swipeEnabled, isInterviewLane, isPotential, isDiscarded, filter, splitMode, expediente, rowClick, openCtxMenu, onPay, t }: PatientRowProps) {
  const longPress = useLongPress(
    openCtxMenu ? (x: number, y: number) => openCtxMenu(x, y, p) : null,
    { enabled: !!openCtxMenu }
  );
  const rowBody = (
    // row click + long-press context menu are pointer affordances
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={`row-item list-entry-stagger ${splitMode && expediente?.id === p.id ? "row-item--selected" : ""} ${isInterviewLane ? "row-potential" : ""} ${isDiscarded ? "row-discarded" : ""}`}
      style={{ "--stagger-i": Math.min(i, 12) } as React.CSSProperties}
      onClick={swipeEnabled ? undefined : rowClick}
      onContextMenu={(e: React.MouseEvent) => isInterviewLane ? null : openCtxMenu?.(e.clientX, e.clientY, p, e)}>
      <Avatar initials={p.initials} color={isInterviewLane ? "var(--rose)" : getClientColor(i)} size="md" />
      <div className="row-content">
        <div className="row-title">{p.name}</div>
        <div className="row-sub">
          {p.parent && (
            <>
              <span style={{ color:"var(--purple)", fontWeight:700 }}>{t("sessions.tutor")}: {p.parent}</span>
              {" · "}
            </>
          )}
          {formatMXN(p.rate)} {t("expediente.perSession")}
        </div>
      </div>
      <div style={{ flexShrink:0 }}>
        {filter === "owes"
          ? <span style={{ fontSize:"var(--text-sm)", fontWeight:800, fontFamily:"var(--font-d)", color:"var(--red)" }}>{formatMXN(p.amountDue)}</span>
          : isPotential
            ? <span className="badge badge-rose">{t("patients.statusPotential")}</span>
            : isDiscarded
              ? <span className="badge badge-gray">{t("patients.statusDiscarded")}</span>
              : <span className={`badge ${p.status==="active"?"badge-teal":"badge-gray"}`}>{p.status==="active"?t("patients.statusActive"):t("patients.statusEnded")}</span>
        }
      </div>
      <span className="row-chevron">›</span>
    </div>
  );
  const inner = swipeEnabled
    ? <SwipeRevealRow
        onClick={rowClick}
        actions={[{
          key: "payment",
          icon: <IconDollar size={20} />,
          label: t("patients.swipePay"),
          color: "var(--green)",
          onAction: () => onPay(p),
        }]}>
        {rowBody}
      </SwipeRevealRow>
    : rowBody;
  return <div {...longPress.bind}>{inner}</div>;
}
