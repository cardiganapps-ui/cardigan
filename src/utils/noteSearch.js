/* ── Note search ─────────────────────────────────────────────────────
   Client-side fuzzy match over already-decrypted notes. Lives outside
   the Notes screen so the helpers can be unit-tested without React.

   Spanish-friendly:
     - normalize() strips diacritics so "sueno" matches "sueño". Uses
       NFD + combining-mark filter; does NOT touch ñ/Ñ, those stay as
       a distinct letter.
     - Multi-word query is treated as AND (every term must appear
       somewhere in the note's searchable text).
     - Empty / whitespace-only query short-circuits to "no filter".

   match() returns the matched notes in their original order; the
   caller still applies its own pinned-first / recency sort. */

// NFD splits accented chars into base + combining mark; the regex
// then drops the marks so the remaining letters match the unaccented
// equivalent. Lowercase first because some marks compose differently
// on uppercase.
export function normalize(s) {
  if (!s) return "";
  // ̀-ͯ is the Unicode "Combining Diacritical Marks" block.
  // After NFD splits "ñ" → "n" + "̃" we strip the mark.
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/* Tokenize the user's query into search terms. Splits on whitespace
   and quotes; quoted phrases stay intact (handy for "primera sesión"
   when the title literally has both words side by side). */
export function tokenize(query) {
  if (!query) return [];
  const out = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(query)) !== null) {
    const term = (m[1] || m[2] || "").trim();
    if (term) out.push(normalize(term));
  }
  return out;
}

/* Build the searchable haystack for a note. Concatenates title +
   content + linked patient name with separators so cross-field
   matches still work but don't bleed across fields semantically. */
export function buildHaystack(note, patient) {
  return normalize([
    note?.title || "",
    note?.content || "",
    patient?.name || "",
  ].join("  ")); //  is just an unlikely separator
}

export function matches(note, patient, terms) {
  if (!terms || terms.length === 0) return true;
  const hay = buildHaystack(note, patient);
  for (const t of terms) {
    if (!hay.includes(t)) return false;
  }
  return true;
}

/* Build a small excerpt around the first match in the note content,
   suitable for surfacing under the title in search results. Length
   is capped at ~120 chars total so it doesn't break the row layout.
   Returns the original (un-normalized) characters so the user reads
   their own text, not the diacritic-stripped form. */
export function buildExcerpt(note, terms, maxLen = 120) {
  const content = note?.content || "";
  if (!content || !terms || terms.length === 0) return "";
  const norm = normalize(content);
  let firstAt = -1;
  for (const t of terms) {
    const idx = norm.indexOf(t);
    if (idx >= 0 && (firstAt < 0 || idx < firstAt)) firstAt = idx;
  }
  if (firstAt < 0) return "";
  // Window: ~40 chars before, rest after.
  const before = Math.max(0, firstAt - 40);
  const slice = content.slice(before, before + maxLen);
  return (before > 0 ? "…" : "") + slice + (before + maxLen < content.length ? "…" : "");
}
