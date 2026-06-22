/* ── noteDiff ────────────────────────────────────────────────────
   Line-based diff for note bodies. Backs VersionHistorySheet's
   "before / after" visual: each chunk is rendered as a strip with
   the matching color (added = teal-mist, removed = red-bg, same =
   plain).

   Implementation is a classic Longest-Common-Subsequence pass +
   reverse-walk to extract operations. O(m × n) time / space — fine
   for note bodies that stay under ~5k lines in practice. (A note
   approaching that size has bigger problems than diff perf.)

   We deliberately operate on line tokens, not characters. Block-level
   diffs read better for prose ("this paragraph changed" vs. "these
   three characters in the middle of this sentence flipped"), and a
   character-level Myers diff would add complexity we don't need for
   v1. If users complain we can layer it in.

   Trimming: leading/trailing whitespace on each line is preserved
   so indentation and markdown list prefixes don't get misdiffed,
   but a trailing \n on the last line is normalized away to keep
   the chunk count predictable. */

interface DiffChunk { type: "same" | "added" | "removed"; text: string }

function splitLines(s?: string | null): string[] {
  if (s == null) return [];
  const out = String(s).split("\n");
  // Drop a single trailing empty line that comes from a trailing
  // newline — the user's mental model is "N lines of text," not
  // "N lines + one empty line."
  if (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/* Longest common subsequence as a 2D length table. Returns the LCS
   length matrix; the caller does the reverse walk to pick operations. */
function lcsLengths(a: string[], b: string[]) {
  const m = a.length;
  const n = b.length;
  // Tight allocation — a single Int32Array beats a 2D array of
  // numbers for both speed and GC pressure.
  const grid = new Int32Array((m + 1) * (n + 1));
  const stride = n + 1;
  for (let i = 1; i <= m; i++) {
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      if (ai === b[j - 1]) {
        grid[i * stride + j] = grid[(i - 1) * stride + (j - 1)] + 1;
      } else {
        const up = grid[(i - 1) * stride + j];
        const left = grid[i * stride + (j - 1)];
        grid[i * stride + j] = up >= left ? up : left;
      }
    }
  }
  return { grid, stride, m, n };
}

/* Compute a list of chunks {type, text}.
     type: "same"   — present in both
           "added"  — present in `b` only
           "removed"— present in `a` only
   Consecutive lines of the same type collapse into one chunk so
   the renderer can paint full-paragraph strips instead of
   per-line slivers. */
export function diffLines(beforeText?: string | null, afterText?: string | null): DiffChunk[] {
  const a = splitLines(beforeText);
  const b = splitLines(afterText);
  if (a.length === 0 && b.length === 0) return [];

  const { grid, stride, m, n } = lcsLengths(a, b);

  // Reverse walk to collect ops, then reverse the result.
  const ops: DiffChunk[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: "same", text: a[i - 1] });
      i--; j--;
    } else {
      const up = i > 0 ? grid[(i - 1) * stride + j] : -1;
      const left = j > 0 ? grid[i * stride + (j - 1)] : -1;
      if (left >= up) {
        ops.push({ type: "added", text: b[j - 1] });
        j--;
      } else {
        ops.push({ type: "removed", text: a[i - 1] });
        i--;
      }
    }
  }
  ops.reverse();

  // Collapse adjacent same-type ops into chunks. Newlines come back
  // in the joined text so the renderer can render each chunk as a
  // pre-wrap block.
  const chunks: DiffChunk[] = [];
  for (const op of ops) {
    const last = chunks[chunks.length - 1];
    if (last && last.type === op.type) {
      last.text += "\n" + op.text;
    } else {
      chunks.push({ type: op.type, text: op.text });
    }
  }
  return chunks;
}

/* Convenience summary — added/removed line counts. Used by the
   version-list row to show "+3 −1" before the user expands the
   diff. */
export function diffSummary(beforeText?: string | null, afterText?: string | null) {
  const a = splitLines(beforeText);
  const b = splitLines(afterText);
  if (a.length === 0 && b.length === 0) return { added: 0, removed: 0 };
  const { grid, stride, m, n } = lcsLengths(a, b);
  const same = grid[m * stride + n];
  return { added: n - same, removed: m - same };
}
