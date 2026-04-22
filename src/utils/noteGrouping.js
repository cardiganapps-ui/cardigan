/* ── Cardigan notes — date bucketing for the list view ───────────────
   Groups notes by how recently they were touched, so the flat
   chronological list scans like Apple Notes: pinned first, then
   Hoy / Ayer / Esta semana / Este mes / Mes anterior / Month-Year.

   The bucket boundaries are:
     "pinned"      → anything with pinned=true (flat, no date sub-sort)
     "today"       → updated_at is same calendar day as now
     "yesterday"   → exactly one calendar day before now
     "thisWeek"    → within 7 days but not today/yesterday
     "thisMonth"   → same calendar month & year (and older than thisWeek)
     "lastMonth"   → previous calendar month
     "YYYY-MM"     → by month-year for older, e.g. "2025-12"

   Within each bucket, notes stay sorted by updated_at desc (the caller
   already pre-sorted). We preserve input order within a bucket, so the
   caller controls the sort within-bucket. */

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function bucketForDate(updatedAt, now = new Date()) {
  if (!updatedAt) return "older";
  const d = new Date(updatedAt);
  const today = startOfDay(now);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekCutoff = new Date(today); weekCutoff.setDate(weekCutoff.getDate() - 6);

  if (sameDay(d, today)) return "today";
  if (sameDay(d, yesterday)) return "yesterday";
  if (d >= weekCutoff && d < today) return "thisWeek";
  if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()) return "thisMonth";
  // last month
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  if (d.getFullYear() === lastMonth.getFullYear() && d.getMonth() === lastMonth.getMonth()) return "lastMonth";
  // older: bucket by year-month
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

/* Display label for a bucket key. `monthYearFormatter` is optional so
   the caller can inject locale-sensitive formatting. Default is
   Spanish-MX long month. */
export function bucketLabel(key, t, now = new Date()) {
  if (key === "pinned") return t?.("notes.groups.pinned") || "Fijadas";
  if (key === "today") return t?.("notes.groups.today") || "Hoy";
  if (key === "yesterday") return t?.("notes.groups.yesterday") || "Ayer";
  if (key === "thisWeek") return t?.("notes.groups.thisWeek") || "Esta semana";
  if (key === "thisMonth") return t?.("notes.groups.thisMonth") || "Este mes";
  if (key === "lastMonth") return t?.("notes.groups.lastMonth") || "Mes anterior";
  // YYYY-MM
  const m = key.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const date = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
    const sameYear = date.getFullYear() === now.getFullYear();
    const opts = sameYear ? { month: "long" } : { month: "long", year: "numeric" };
    // Capitalize first letter (es-MX long month is lowercase).
    const str = date.toLocaleDateString("es-MX", opts);
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  return key;
}

/* Group a pre-sorted list of notes into an ordered array of
   { key, label, notes } buckets. `pinned=true` notes are pulled to
   the top regardless of date. */
export function groupNotesByRecency(notes, t, now = new Date()) {
  if (!notes || notes.length === 0) return [];
  const order = ["pinned", "today", "yesterday", "thisWeek", "thisMonth", "lastMonth"];
  const buckets = new Map();
  const monthKeys = [];

  for (const note of notes) {
    let key;
    if (note.pinned) key = "pinned";
    else key = bucketForDate(note.updated_at, now);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      if (!order.includes(key)) monthKeys.push(key);
    }
    buckets.get(key).push(note);
  }

  // Sort month-year keys descending (newest first)
  monthKeys.sort((a, b) => b.localeCompare(a));
  const keyOrder = [...order.filter(k => buckets.has(k)), ...monthKeys];

  return keyOrder.map(key => ({
    key,
    label: bucketLabel(key, t, now),
    notes: buckets.get(key),
  }));
}
