/* ── Session display helpers used across Cardigan ── */

export function isTutorSession(s) {
  return s.initials?.startsWith("T·");
}

export function tutorDisplayInitials(s) {
  return s.initials?.replace("T·", "") || "T";
}

export function isCancelledStatus(status) {
  return status === "cancelled" || status === "charged";
}

export function statusClass(status) {
  if (status === "scheduled") return "status-scheduled";
  if (status === "completed") return "status-completed";
  return "status-cancelled";
}

export function statusLabel(status) {
  if (isCancelledStatus(status)) return "Cancelada";
  if (status === "completed") return "Completada";
  return "Agendada";
}

export function shortName(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function sessionDisplayLabel(s) {
  return `${s.date} · ${s.time} — ${statusLabel(s.status)}`;
}
