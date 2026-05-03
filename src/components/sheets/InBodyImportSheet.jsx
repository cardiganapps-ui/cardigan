import { useState, useRef, useMemo, useCallback } from "react";
import { IconX, IconUpload } from "../Icons";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useCardigan } from "../../context/CardiganContext";
import { parseInBodyCSV, parseInBodyXLSX } from "../../utils/inbody";
import { haptic } from "../../utils/haptics";

/* ── InBodyImportSheet ───────────────────────────────────────────
   Three-step bottom sheet for ingesting a LookinBody CSV export
   into a single patient's measurement history.

     1. Pick — drop zone for the CSV file
     2. Preview — list of parsed scans, with checkboxes per row.
        Rows whose embedded patient name doesn't match the current
        patient default to unchecked but stay visible (LookinBody
        often dumps multi-patient histories in one file).
     3. Confirm — bulk insert via useMeasurements::bulkCreateMeasurements

   The parser is pure (src/utils/inbody.js) and runs synchronously in
   the browser; even a 1000-row file parses in <50ms so there's no
   need for a worker. The DB partial unique index on
   (patient_id, scanned_at, source) makes re-imports idempotent at
   the schema level — the local pre-filter in bulkCreateMeasurements
   is the suspenders, the index is the belt. */

export function InBodyImportSheet({ open, patient, onClose, onImported }) {
  const { t } = useT();
  const { measurements, bulkCreateMeasurements, showSuccess } = useCardigan();
  useEscape(open ? onClose : null);
  const panelRef = useFocusTrap(open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: open });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const fileInputRef = useRef(null);
  const [step, setStep] = useState("pick"); // "pick" | "preview" | "saving"
  const [parseResult, setParseResult] = useState(null); // { rows, warnings }
  const [selected, setSelected] = useState(() => new Set()); // scanned_at strings
  const [parseError, setParseError] = useState("");
  const [dropHover, setDropHover] = useState(false);

  // Track which scans the patient already has so we can flag rows as
  // "ya importada" in the preview. Keys on a canonicalized timestamp
  // — Supabase returns timestamptz as `2026-04-12T10:30:00+00:00`
  // while the parser emits `…Z`; both refer to the same instant but
  // the strings differ, so we round-trip through Date for stable
  // comparison.
  const existingScansForPatient = useMemo(() => {
    const set = new Set();
    for (const m of measurements || []) {
      if (m.patient_id === patient?.id && m.scanned_at) {
        const iso = canonIso(m.scanned_at);
        if (iso) set.add(iso);
      }
    }
    return set;
  }, [measurements, patient?.id]);

  const toggleRow = useCallback((scannedAt) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(scannedAt)) next.delete(scannedAt);
      else next.add(scannedAt);
      return next;
    });
  }, []);

  const selectedRows = useMemo(() => {
    if (!parseResult) return [];
    return parseResult.rows.filter((r) => selected.has(r.scanned_at));
  }, [parseResult, selected]);

  if (!open) return null;

  const handleFile = async (file) => {
    setParseError("");
    if (!file) return;
    const name = (file.name || "").toLowerCase();
    const isCsv  = name.endsWith(".csv")  || (file.type || "").includes("csv");
    const isXlsx = name.endsWith(".xlsx") || (file.type || "").includes("spreadsheetml");
    // Legacy .xls (binary, pre-2007) is the OOXML predecessor and is
    // a different format that read-excel-file doesn't support. Tell
    // the user explicitly instead of routing it down the xlsx path
    // and getting a generic "no pudimos leer" — most users can
    // re-export as .xlsx or .csv.
    const isLegacyXls = name.endsWith(".xls") && !isXlsx;

    if (isLegacyXls) {
      setParseError(t("measurements.import.errors.legacyXls"));
      return;
    }
    if (!isCsv && !isXlsx) {
      setParseError(t("measurements.import.errors.unsupportedFile"));
      return;
    }

    let result;
    if (isXlsx) {
      result = await parseInBodyXLSX(file, { expectedName: patient?.name });
    } else {
      let text;
      try {
        text = await file.text();
      } catch {
        setParseError(t("measurements.import.errors.readFailed"));
        return;
      }
      result = parseInBodyCSV(text, { expectedName: patient?.name });
    }

    if (!result.rows.length) {
      // Translate the most common warning codes into actionable Spanish.
      const code = result.warnings[0] || "no_data_rows";
      const msg = {
        empty:             t("measurements.import.errors.empty"),
        no_data_rows:      t("measurements.import.errors.noDataRows"),
        no_weight_column:  t("measurements.import.errors.noWeightColumn"),
        row_without_date:  t("measurements.import.errors.noDataRows"),
        xlsx_read_failed:  t("measurements.import.errors.readFailed"),
      }[code] || t("measurements.import.errors.noDataRows");
      setParseError(msg);
      return;
    }
    setParseResult(result);
    // Default selection: rows that match this patient AND aren't
    // already in the DB. Everything else stays visible but unchecked.
    const initial = new Set();
    for (const r of result.rows) {
      const iso = canonIso(r.scanned_at);
      if (r._matchesPatient && iso && !existingScansForPatient.has(iso)) {
        initial.add(r.scanned_at);
      }
    }
    setSelected(initial);
    setStep("preview");
    haptic.tap();
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDropHover(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  const confirmImport = async () => {
    if (selectedRows.length === 0 || !patient?.id) return;
    setStep("saving");
    const result = await bulkCreateMeasurements({
      patientId: patient.id,
      rows: selectedRows,
    });
    if (result.created > 0) {
      const msg = result.skipped > 0
        ? t("measurements.import.successMixed", {
            created: String(result.created),
            skipped: String(result.skipped),
          })
        : t("measurements.import.success", { created: String(result.created) });
      showSuccess?.(msg);
      haptic.success();
      onImported?.(result);
      onClose();
    } else {
      setParseError(t("measurements.import.errors.writeFailed"));
      setStep("preview");
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose} role="presentation">
      <div
        ref={setPanel}
        className="sheet-panel inbody-import-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbody-import-title"
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}>
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <div id="inbody-import-title" className="sheet-title">
            {t("measurements.import.title")}
          </div>
          <button
            type="button"
            className="sheet-close"
            aria-label={t("close")}
            onClick={onClose}>
            <IconX size={14} />
          </button>
        </div>

        {step === "pick" && (
          <div style={{ padding: "0 20px 20px" }}>
            <p className="inbody-import-intro">
              {t("measurements.import.intro")}
            </p>
            <div
              className={"av-picker-drop" + (dropHover ? " is-hover" : "")}
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => { e.preventDefault(); setDropHover(true); }}
              onDragLeave={() => setDropHover(false)}
              onDrop={onDrop}>
              <div className="av-picker-drop-icon"><IconUpload size={16} /></div>
              <div className="av-picker-drop-title">
                {t("measurements.import.dropTitle")}
              </div>
              <div className="av-picker-drop-sub">
                {t("measurements.import.dropSub")}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
            {parseError && (
              <div className="av-picker-error" role="alert">{parseError}</div>
            )}
            <div className="inbody-import-help">
              {t("measurements.import.help")}
            </div>
          </div>
        )}

        {(step === "preview" || step === "saving") && parseResult && (
          <div style={{ padding: "0 20px 20px" }}>
            <div className="inbody-import-summary">
              {t("measurements.import.foundRows", { count: String(parseResult.rows.length) })}
            </div>
            <div className="inbody-import-list" role="list">
              {parseResult.rows.map((r) => {
                const isSelected = selected.has(r.scanned_at);
                const alreadyImported = existingScansForPatient.has(canonIso(r.scanned_at));
                const dateLabel = formatDateLabel(r.scanned_at);
                const weight = r.weight_kg != null ? `${fmt(r.weight_kg)} kg` : "—";
                const bodyFat = r.body_fat_pct != null ? `${fmt(r.body_fat_pct)}%` : null;
                return (
                  <label
                    key={r.scanned_at}
                    className={"inbody-import-row" + (alreadyImported ? " is-existing" : "")}
                    role="listitem">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={alreadyImported || step === "saving"}
                      onChange={() => toggleRow(r.scanned_at)}
                    />
                    <div className="inbody-import-row-main">
                      <div className="inbody-import-row-top">
                        <strong>{dateLabel}</strong>
                        {alreadyImported && (
                          <span className="inbody-import-row-tag">
                            {t("measurements.import.tagExisting")}
                          </span>
                        )}
                        {!r._matchesPatient && !alreadyImported && (
                          <span className="inbody-import-row-tag warn">
                            {t("measurements.import.tagOtherPatient")}
                          </span>
                        )}
                      </div>
                      <div className="inbody-import-row-fields">
                        {weight}
                        {bodyFat ? ` · ${bodyFat} ${t("measurements.import.fat")}` : ""}
                        {r._name ? ` · ${r._name}` : ""}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            {parseError && (
              <div className="av-picker-error" role="alert">{parseError}</div>
            )}
            <div className="inbody-import-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setStep("pick"); setParseResult(null); setSelected(new Set()); setParseError(""); }}
                disabled={step === "saving"}>
                {t("measurements.import.changeFile")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmImport}
                disabled={selectedRows.length === 0 || step === "saving"}>
                {step === "saving"
                  ? t("measurements.import.saving")
                  : t("measurements.import.confirm", { count: String(selectedRows.length) })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "";
  return Number(n).toFixed(1).replace(/\.0$/, "");
}

/* Round-trip an ISO string through Date so two equivalent
   representations (`+00:00` vs `Z`, with-vs-without millis) compare
   equal. Returns null on unparseable input. */
function canonIso(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/* "2026-04-12T10:30:00.000Z" → "12 Abr · 10:30" */
function formatDateLabel(iso) {
  if (!iso) return "";
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, , mm, dd, hh, mi] = m;
  const date = `${parseInt(dd, 10)} ${months[parseInt(mm, 10) - 1]}`;
  // Hide the "12:00" placeholder that we synthesize when LookinBody
  // emits a date without a time — it'd just be noise on the row.
  if (hh === "12" && mi === "00") return date;
  return `${date} · ${hh}:${mi}`;
}
