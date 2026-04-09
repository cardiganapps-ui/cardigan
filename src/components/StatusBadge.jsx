import { statusClass, statusLabel } from "../utils/sessions";

export function StatusBadge({ status, style }) {
  return (
    <span className={`session-status ${statusClass(status)}`} style={style}>
      {statusLabel(status)}
    </span>
  );
}
