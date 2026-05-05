/* ── CSV export helper ──
   Used by the Users / Reports / Audit / Revenue invoice tables.
   Trivial client-side serialization from already-fetched JSON — no
   round-trip needed for the v1 data volumes. */
function escape(value) {
  if (value == null) return "";
  const s = String(value);
  // Quote if value contains a comma, double quote, newline, or
  // leading/trailing whitespace that Excel would strip.
  if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsv(filename, rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => escape(typeof c.get === "function" ? c.get(row) : row[c.key])).join(",")
  ).join("\n");
  const csv = "﻿" + header + "\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = filename.replace("{date}", stamp);
  a.click();
  URL.revokeObjectURL(url);
}
