/* ── Monthly summary PDF generator ────────────────────────────────────
   Builds a one-page PDF the therapist can save / forward to their
   accountant. Uses jsPDF directly (no DOM-to-PDF intermediary) so
   the output is small (~10 KB) and fast (<50ms on mid-range phones).

   Content: KPIs at the top, payments table by patient, sessions count
   by status, footer with date + Cardigan branding. Spanish copy
   throughout, MXN formatting via toLocaleString("es-MX").

   Pure helper — takes arrays + a month spec, returns the configured
   jsPDF instance the caller can .save() or .output() as needed. */

import { jsPDF } from "jspdf";

const SHORT_MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const FULL_MONTHS_ES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

// "8-Abr" / "8 Abr" → { day, monthIdx } | null
function parseShort(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2})[\s-]([A-Za-zÁÉÍÓÚáéíóú]{3})/);
  if (!m) return null;
  const monthIdx = SHORT_MONTHS_ES.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
  if (monthIdx < 0) return null;
  return { day: parseInt(m[1], 10), monthIdx };
}

function formatMxn(n) {
  return `$${Number(n || 0).toLocaleString("es-MX")}`;
}

/* Filter rows whose stored "D-MMM" date falls in the target month.
   We don't know the year on the row — Cardigan stores month-day
   only — so we treat the input arrays as already-this-year. The
   caller passes only the relevant rows. (For year-end summaries
   we'd need a different strategy.) */
function rowsInMonth(rows, monthIdx) {
  return (rows || []).filter((r) => {
    const p = parseShort(r.date);
    return p && p.monthIdx === monthIdx;
  });
}

/* Public API. `now` defaults to today; pass an explicit Date to
   render a previous month. Returns the jsPDF instance. */
export function buildMonthlySummaryPdf({
  payments,
  sessions,
  patients,
  now = new Date(),
  therapistName = "",
}) {
  const monthIdx = now.getMonth();
  const monthLabel = FULL_MONTHS_ES[monthIdx];
  const year = now.getFullYear();

  const monthPayments = rowsInMonth(payments, monthIdx);
  const monthSessions = rowsInMonth(sessions, monthIdx);

  const totalCollected = monthPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const sessionCount = monthSessions.length;
  const completedCount = monthSessions.filter(s => s.status === "completed" || s.status === "charged").length;
  const cancelledCount = monthSessions.filter(s => s.status === "cancelled").length;
  const scheduledCount = monthSessions.filter(s => s.status === "scheduled").length;

  // Group payments by patient → display ordered by amount descending.
  const byPatient = new Map();
  for (const p of monthPayments) {
    const key = p.patientName || p.patient || "—";
    byPatient.set(key, (byPatient.get(key) || 0) + Number(p.amount || 0));
  }
  const patientRows = Array.from(byPatient.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  const totalOutstanding = (patients || []).reduce((s, p) => s + Number(p.amountDue || 0), 0);

  // ── Render ──
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = margin;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(46, 46, 46);
  doc.text("Cardigan", margin, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(`Resumen de ${monthLabel} ${year}`, margin, y + 12);
  if (therapistName) {
    doc.text(therapistName, pageWidth - margin, y + 12, { align: "right" });
  }
  y += 24;

  // Divider
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // KPIs grid (3 cols, 2 rows)
  const kpis = [
    { label: "Cobrado este mes", value: formatMxn(totalCollected), accent: "teal" },
    { label: "Sesiones realizadas", value: String(completedCount), accent: "charcoal" },
    { label: "Por cobrar", value: formatMxn(totalOutstanding), accent: "amber" },
  ];
  const colWidth = (pageWidth - margin * 2) / kpis.length;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  for (let i = 0; i < kpis.length; i++) {
    const x = margin + colWidth * i;
    doc.setFont("helvetica", "normal");
    doc.text(kpis[i].label.toUpperCase(), x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(46, 46, 46);
    doc.text(kpis[i].value, x, y + 8);
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
  }
  y += 22;

  // Sessions breakdown
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(46, 46, 46);
  doc.text("Sesiones del mes", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`Total agendadas: ${sessionCount}`, margin, y);
  y += 5;
  doc.text(`Realizadas / cobradas: ${completedCount}`, margin, y);
  y += 5;
  doc.text(`Programadas pendientes: ${scheduledCount}`, margin, y);
  y += 5;
  doc.text(`Canceladas: ${cancelledCount}`, margin, y);
  y += 12;

  // Payments table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(46, 46, 46);
  doc.text("Cobros por paciente", margin, y);
  y += 8;

  if (patientRows.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(160, 160, 160);
    doc.text("Sin cobros registrados este mes.", margin, y);
    y += 8;
  } else {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(120, 120, 120);
    doc.text("Paciente", margin, y);
    doc.text("Cobrado", pageWidth - margin, y, { align: "right" });
    y += 2;
    doc.setDrawColor(230, 230, 230);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(46, 46, 46);

    const pageHeight = doc.internal.pageSize.getHeight();
    for (const row of patientRows) {
      // Page break if we run out of room above the footer.
      if (y > pageHeight - 30) {
        doc.addPage();
        y = margin;
      }
      doc.text(row.name, margin, y);
      doc.text(formatMxn(row.amount), pageWidth - margin, y, { align: "right" });
      y += 6;
    }
    // Total
    y += 2;
    doc.setDrawColor(230, 230, 230);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.text("Total", margin, y);
    doc.text(formatMxn(totalCollected), pageWidth - margin, y, { align: "right" });
    y += 8;
  }

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  const generatedAt = now.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  doc.text(`Generado el ${generatedAt} desde cardigan.mx`, margin, pageHeight - 12);

  return doc;
}

export function downloadMonthlySummaryPdf(args) {
  const doc = buildMonthlySummaryPdf(args);
  const m = SHORT_MONTHS_ES[(args.now || new Date()).getMonth()];
  const y = (args.now || new Date()).getFullYear();
  doc.save(`Cardigan-resumen-${m}-${y}.pdf`);
}
