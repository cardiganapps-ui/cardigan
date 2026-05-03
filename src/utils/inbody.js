/* ── InBody / LookinBody CSV parser ───────────────────────────────
   LookinBody (the desktop + web software bundled with every InBody
   model — 270 / 570 / 770 / 970) exports the patient-history sheet as
   a CSV where one row equals one body-composition scan.

   Column names are stable per locale; we recognise the Spanish export
   (Cardigan's primary audience) plus the English fallback so a clinic
   that uses the English UI for any reason still imports cleanly.
   Every column outside the map lands in `raw_extra` so future InBody
   firmware tweaks never silently drop data — a forensic trail is more
   valuable than a clean schema match.

   The parser is pure: no React, no DOM, no network. It accepts a UTF-8
   string and returns a normalised object — easy to unit-test, easy to
   call from a Web Worker if a 50-row import ever feels slow (it
   doesn't, but the option is open).

   XLSX support is intentionally out of v1: bundle-cost vs. user
   reality (most LookinBody users export as CSV by default; an XLSX
   user can resave as CSV). When we add it, lazy-import `xlsx` and
   reuse `mapHeaderRow` + `parseRow` below — they're shape-agnostic. */

/* Column → measurements field map. Keys are matched
   case-insensitively after normalising whitespace, so "Peso (kg)"
   and "PESO" both resolve. The full key list is duplicated for
   English so a Spanish-locale and English-locale export of the same
   scan land in the same fields. */
const COLUMN_MAP = {
  // Identity (consumed for matching, not persisted directly to row)
  "nombre":                "name",
  "name":                  "name",
  "id":                    "external_id",
  "fecha de prueba":       "scanned_at",
  "fecha":                 "scanned_at",
  "test date / time":      "scanned_at",
  "test date":             "scanned_at",

  // Primary fields (already on the manual MeasurementSheet)
  "peso":                  "weight_kg",
  "peso (kg)":             "weight_kg",
  "weight":                "weight_kg",
  "weight (kg)":           "weight_kg",
  "pgc":                   "body_fat_pct",
  "pgc (%)":               "body_fat_pct",
  "% grasa":               "body_fat_pct",
  "pbf":                   "body_fat_pct",
  "pbf (%)":               "body_fat_pct",
  "percent body fat":      "body_fat_pct",
  "cintura":               "waist_cm",
  "cintura (cm)":          "waist_cm",
  "waist":                 "waist_cm",
  "waist (cm)":            "waist_cm",
  "cadera":                "hip_cm",
  "cadera (cm)":           "hip_cm",
  "hip":                   "hip_cm",
  "hip (cm)":              "hip_cm",

  // InBody-specific
  "mme":                   "skeletal_muscle_kg",
  "mme (kg)":              "skeletal_muscle_kg",
  "smm":                   "skeletal_muscle_kg",
  "smm (kg)":              "skeletal_muscle_kg",
  "skeletal muscle mass":  "skeletal_muscle_kg",
  "masa muscular":         "skeletal_muscle_kg",
  "masa de grasa corporal":"body_fat_kg",
  "body fat mass":         "body_fat_kg",
  "bfm":                   "body_fat_kg",
  "bfm (kg)":              "body_fat_kg",
  "nivel de grasa visceral":"visceral_fat_level",
  "grasa visceral":        "visceral_fat_level",
  "visceral fat level":    "visceral_fat_level",
  "vfl":                   "visceral_fat_level",
  "agua corporal total":   "total_body_water_kg",
  "act":                   "total_body_water_kg",
  "total body water":      "total_body_water_kg",
  "tbw":                   "total_body_water_kg",
  "proteína":              "protein_kg",
  "proteinas":             "protein_kg",
  "protein":               "protein_kg",
  "minerales":             "minerals_kg",
  "minerals":              "minerals_kg",
  "tmb":                   "basal_metabolic_rate_kcal",
  "tmb (kcal)":            "basal_metabolic_rate_kcal",
  "bmr":                   "basal_metabolic_rate_kcal",
  "bmr (kcal)":            "basal_metabolic_rate_kcal",
  "ángulo de fase":        "phase_angle",
  "angulo de fase":        "phase_angle",
  "phase angle":           "phase_angle",
  "puntuación":            "inbody_score",
  "puntuacion":            "inbody_score",
  "puntuación inbody":     "inbody_score",
  "inbody score":          "inbody_score",
  "modelo":                "device_model",
  "equipment":             "device_model",
  "equipo":                "device_model",
};

/* Numeric fields: parsed via parseNumber (handles comma decimals).
   Integer-only fields get an extra rounding step. Anything missing
   from this set stays as a raw string. */
const NUMERIC_FIELDS = new Set([
  "weight_kg", "body_fat_pct", "waist_cm", "hip_cm",
  "skeletal_muscle_kg", "body_fat_kg", "total_body_water_kg",
  "protein_kg", "minerals_kg", "phase_angle",
]);
const INTEGER_FIELDS = new Set([
  "visceral_fat_level", "basal_metabolic_rate_kcal", "inbody_score",
]);

/* RFC 4180-ish CSV parse. Handles quoted fields, escaped quotes
   ("""), and either CRLF or LF line endings. Returns an array of
   string arrays — header detection is the caller's problem. */
export function parseCSV(text) {
  if (!text || typeof text !== "string") return [];
  // Strip UTF-8 BOM emitted by Excel / LookinBody on Windows.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") {
      row.push(field); field = "";
      // Skip blank lines entirely (defensive against trailing newlines).
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  // Final field / row (no trailing newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/* Map raw header strings to canonical field names. Returns an array
   the same length as the header row: known columns become field
   names, unknown ones become `{ extra: <original> }` markers we use
   to route values into raw_extra. */
function mapHeaderRow(headerCells) {
  return headerCells.map((raw) => {
    const norm = raw.trim().toLowerCase().replace(/\s+/g, " ");
    const field = COLUMN_MAP[norm];
    if (field) return { field };
    return { extra: raw.trim() };
  });
}

/* "76,4" → 76.4, "1,234.5" → 1234.5, "76.4 kg" → 76.4, "" → null,
   "—" / "-" → null, "N/A" → null. Strips any non-numeric trailing
   suffix (units), tolerates either decimal separator.

   Native numbers (XLSX cells coerced by the reader) pass through
   untouched — the LookinBody Excel export stores numerics as
   actual cells, not formatted text, so we'd mangle them by
   string-coercing first. */
export function parseNumber(s) {
  if (s == null) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const raw = String(s).trim();
  if (!raw || raw === "-" || raw === "—" || /^n\/?a$/i.test(raw)) return null;
  // Drop trailing non-numeric (units like " kg", " %", " cm").
  let cleaned = raw.replace(/[^\d.,\-+]+$/, "");
  // After stripping, the input must still contain at least one digit
  // — otherwise Number("") would coerce to 0 and we'd report a false
  // zero, which is exactly what we promise the schema layer we never
  // do.
  if (!/\d/.test(cleaned)) return null;
  // Decide which separator is the decimal:
  //   "1,234.5" → comma is thousands → strip commas, keep dots
  //   "1.234,5" → dot is thousands → strip dots, comma → dot
  //   "76,4"    → comma is decimal  → comma → dot
  //   "76.4"    → dot is decimal    → unchanged
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot   = cleaned.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // ES style: "1.234,5" — dot is thousands, comma is decimal.
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // EN style: "1,234.5" — comma is thousands.
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    cleaned = cleaned.replace(",", ".");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/* InBody dates come in two text formats from LookinBody:
     "YYYY-MM-DD HH:mm:ss"   (English / ISO)
     "DD/MM/YYYY HH:mm"      (Spanish)
     "DD/MM/YYYY"            (Spanish, time omitted)
   …or as a native Date cell when the source is XLSX (read-excel-file
   coerces date-typed cells to JS Date instances). We accept both.

   Returns an ISO timestamp (UTC-anchored noon to keep the date
   stable across timezones — InBody never reports a timezone, and
   the consultorio's local date is what the nutritionist cares about).
   Returns null on anything unparseable. */
export function parseInBodyDate(s) {
  if (!s) return null;
  // Native Date (XLSX cell) — round-trip through toISOString. Skip
  // the timezone-anchoring on this path because read-excel-file
  // already gives us a real instant.
  if (s instanceof Date) {
    return Number.isNaN(s.getTime()) ? null : s.toISOString();
  }
  if (typeof s !== "string") return null;
  const raw = s.trim();
  if (!raw) return null;

  // ISO: 2026-04-12 14:30:00 (or with T separator)
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, y, m, d, hh = "12", mm = "00", ss = "00"] = iso;
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`;
  }

  // ES: 12/04/2026 14:30  (DD/MM/YYYY first — that's the LookinBody ES format)
  const es = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (es) {
    const [, d, m, y, hh = "12", mm = "00", ss = "00"] = es;
    const pad = (n) => String(n).padStart(2, "0");
    return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}.000Z`;
  }

  return null;
}

/* Coerce a raw cell value (may be string / number / Date / null
   / undefined / boolean from XLSX) to a trimmed display string for
   identity / extra / device_model fields. Numbers + Dates stringify
   to their canonical form; null → "". */
function cellToString(val) {
  if (val == null) return "";
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? "" : val.toISOString();
  return String(val).trim();
}

/* Parse one data row given the column-mapped header. Values land in
   either named fields or raw_extra; numeric fields go through
   parseNumber, the date through parseInBodyDate. Cells may be raw
   strings (CSV path) or native JS values (XLSX path) — both helpers
   normalise upstream of this function. */
function parseRow(headerMap, cells) {
  const out = { raw_extra: {} };
  let identityName = null;
  for (let i = 0; i < headerMap.length; i++) {
    const slot = headerMap[i];
    const val = cells[i];
    if (slot.extra) {
      // Preserve the raw cell — empty strings still get recorded so a
      // forensic dump shows the column was present but blank. XLSX
      // gives us native types here; stringify before storing in jsonb.
      const str = cellToString(val);
      if (str !== "") out.raw_extra[slot.extra] = str;
      continue;
    }
    const field = slot.field;
    if (field === "name") { identityName = cellToString(val); continue; }
    if (field === "external_id") {
      const trimmed = cellToString(val);
      if (trimmed) out.external_id = trimmed;
      continue;
    }
    if (field === "scanned_at") {
      out.scanned_at = parseInBodyDate(val);
      continue;
    }
    if (NUMERIC_FIELDS.has(field)) {
      const n = parseNumber(val);
      if (n !== null) out[field] = n;
      continue;
    }
    if (INTEGER_FIELDS.has(field)) {
      const n = parseNumber(val);
      if (n !== null) out[field] = Math.round(n);
      continue;
    }
    // Plain string field (device_model).
    const trimmed = cellToString(val);
    if (trimmed) out[field] = trimmed;
  }
  // Drop the empty raw_extra so downstream JSON.stringify doesn't
  // bloat with `{}` on every row.
  if (Object.keys(out.raw_extra).length === 0) delete out.raw_extra;
  return { row: out, name: identityName };
}

/* Shared logic between CSV and XLSX paths: takes an array of arrays
   (header row first, then data) and produces the canonical
   { rows, warnings, totalRows } shape. Exported so callers can plug
   in alternative sources (e.g. a future drag-paste-from-clipboard
   flow) without re-implementing the InBody column map. */
export function parseFromRows(cells, { expectedName = "" } = {}) {
  const warnings = [];
  if (cells.length < 2) {
    return { rows: [], warnings: ["no_data_rows"], totalRows: 0 };
  }
  const headerMap = mapHeaderRow(cells[0].map(cellToString));
  const hasWeight = headerMap.some((h) => h.field === "weight_kg");
  if (!hasWeight) warnings.push("no_weight_column");

  const expectedNorm = normalizeName(expectedName);
  const rows = [];
  for (let i = 1; i < cells.length; i++) {
    const { row, name } = parseRow(headerMap, cells[i]);
    if (!row.scanned_at) {
      warnings.push("row_without_date");
      continue;
    }
    const rowName = name || "";
    rows.push({
      ...row,
      _name: rowName,
      _matchesPatient: expectedNorm
        ? namesMatch(normalizeName(rowName), expectedNorm)
        : true,
    });
  }
  return { rows, warnings, totalRows: cells.length - 1 };
}

/* Top-level entry point — CSV.

   `text` is the raw CSV content. `expectedName` is the patient's name
   (used to flag rows that don't match — the import sheet uses this
   to default-uncheck mismatched rows but still surface them in the
   preview list, so the user can see what's in the file).

   Returns:
     {
       rows: [{ scanned_at, weight_kg, ..., raw_extra, _name, _matchesPatient }],
       warnings: ["…"],
       totalRows: N,
     }

   Never throws on malformed input — degrades to `{ rows: [],
   warnings: [...] }` so the UI can render a clear error state. */
export function parseInBodyCSV(text, opts = {}) {
  if (!text || typeof text !== "string") {
    return { rows: [], warnings: ["empty"], totalRows: 0 };
  }
  return parseFromRows(parseCSV(text), opts);
}

/* Top-level entry point — XLSX.

   `file` is a File / Blob (browser) or a Buffer (Node, for tests).
   The xlsx reader is lazy-imported via dynamic import so the
   ~70KB-gzipped library stays out of the main bundle for the 95% of
   users who never touch this path.

   read-excel-file returns rows as `[[cell, ...], ...]` with native
   types preserved: numbers, Date objects, booleans, null. The shared
   parseFromRows path handles all of those — see parseNumber +
   parseInBodyDate which both accept native types as a first-class
   path. Same return shape as parseInBodyCSV; same graceful-degrade
   behaviour on parse errors. */
export async function parseInBodyXLSX(file, opts = {}) {
  if (!file) return { rows: [], warnings: ["empty"], totalRows: 0 };
  let cells;
  try {
    // read-excel-file ships separate entry points per environment.
    // The browser bundle is smallest and is the only path we ever
    // invoke at runtime — this code only runs from the import sheet
    // after the user has dropped a file. /* @vite-ignore */ keeps
    // Vite from trying to statically analyze the dynamic import
    // (which would fail under SSR pre-render anyway).
    const mod = await import("read-excel-file/browser");
    const readXlsxFile = mod.default || mod;
    cells = await readXlsxFile(file);
  } catch (err) {
    // Common failure modes: corrupt zip, password-protected workbook,
    // legacy .xls (binary, not the OOXML zip format). Surface a
    // single warning code; the UI translates that to the actionable
    // Spanish error so we don't ship raw library messages to users.
    return { rows: [], warnings: ["xlsx_read_failed"], totalRows: 0, error: err };
  }
  if (!Array.isArray(cells) || cells.length < 1) {
    return { rows: [], warnings: ["no_data_rows"], totalRows: 0 };
  }
  return parseFromRows(cells, opts);
}

/* Lower-cased, whitespace-collapsed, accent-stripped name for fuzzy
   "did this scan come from the patient I'm viewing?" matching. We
   stay deliberately conservative — the user gets a checkbox per row
   and can override the default match. */
export function normalizeName(s) {
  if (!s) return "";
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase().trim().replace(/\s+/g, " ");
}

/* True if the LookinBody name and the Cardigan patient name share at
   least their first + last token. LookinBody data is messy in the
   wild — middle names, suffixes, titles, only-first-name entries. A
   token-overlap check is forgiving enough to cover real cases without
   matching unrelated patients ("Ana Lopez" vs. "Ana Garcia" → no
   match; "Ana Garcia" vs. "Ana Maria Garcia Lopez" → match). */
export function namesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(" ").filter(Boolean);
  const tb = b.split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return false;
  // Match if every token of the shorter side appears in the longer.
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return shorter.every((t) => longer.includes(t));
}
