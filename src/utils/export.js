export function exportCSV(filename, headers, rows) {
  const escape = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportSessions(sessions, filename = "sesiones.csv") {
  const headers = ["Paciente", "Fecha", "Hora", "Duración (min)", "Día", "Estado", "Tipo"];
  const rows = sessions.map(s => [
    s.patient,
    s.date,
    s.time,
    s.duration || 60,
    s.day,
    s.status === "completed" ? "Completada" : s.status === "scheduled" ? "Agendada" : s.status === "charged" ? "Cancelada (cobrada)" : "Cancelada",
    s.initials?.startsWith("T·") ? "Tutor" : "Paciente",
  ]);
  exportCSV(filename, headers, rows);
}

export function exportPayments(payments, filename = "pagos.csv") {
  const headers = ["Paciente", "Monto", "Fecha", "Método"];
  const rows = payments.map(p => [
    p.patient,
    p.amount,
    p.date,
    p.method,
  ]);
  exportCSV(filename, headers, rows);
}
