import { IconCheck } from "./Icons";
import { SESSION_STATUS } from "../data/constants";
import { haptic } from "../utils/haptics";

/* ── Inline session status toggle ──
   One-tap mark-complete / revert for a session row, avoiding the 3-tap
   path (open row → open sheet → tap button). Shown for scheduled and
   completed sessions only; cancelled/charged sessions still need the
   sheet (destructive + requires optional reason). Tap propagation is
   stopped so the row's onClick (which opens the sheet) doesn't also
   fire. */

export function SessionStatusToggle({ session, onToggle, disabled }) {
  const status = session.status;
  const toggleable =
    status === SESSION_STATUS.SCHEDULED ||
    status === SESSION_STATUS.COMPLETED;
  if (!toggleable) return null;

  const isCompleted = status === SESSION_STATUS.COMPLETED;
  const nextStatus = isCompleted
    ? SESSION_STATUS.SCHEDULED
    : SESSION_STATUS.COMPLETED;

  const handleClick = async (e) => {
    e.stopPropagation();
    if (disabled) return;
    haptic.tap();
    await onToggle(session, nextStatus);
    if (!isCompleted) haptic.success();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={isCompleted ? "Revertir a agendada" : "Marcar completada"}
      className={`session-toggle ${isCompleted ? "session-toggle--done" : "session-toggle--pending"}`}>
      <IconCheck size={14} />
    </button>
  );
}
