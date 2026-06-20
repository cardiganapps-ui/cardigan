/* ── Pagination ── Fetch every row of a query in fixed-size pages.

   PostgREST (Supabase) caps each response at the server's `max_rows`
   (1000 for this project). A single `.limit(N)` is therefore silently
   truncated at the cap, which is dangerous for the sessions table —
   accounting sums over a patient's ENTIRE history, so a dropped overflow
   row understates `consumed` and the balance. This helper pages through
   the full result set instead.

   It is deliberately transport-agnostic: the caller supplies a
   `fetchPage(from, to)` that resolves to `{ data, error }` (a Supabase
   range query is exactly that), so the loop is pure and unit-testable
   against a fake page source.

   Correctness notes:
   - We advance by the number of rows ACTUALLY returned, never a fixed
     stride, so the loop stays aligned even when the server cap is smaller
     than `pageSize`.
   - Termination is ONLY on an empty page. We deliberately do NOT stop on
     a short (non-empty) page: a page shorter than `pageSize` is
     ambiguous — it can mean "last page" OR "server cap < pageSize, more
     remain". Stopping on it is exactly the silent-truncation bug this
     helper exists to prevent. The price is one extra (empty) request at
     the tail, which is negligible for a once-per-refresh fetch and buys
     correctness under any server cap.
   - On error we return what we have so far alongside the error, so the
     caller can decide whether a partial set is usable (it generally is
     not — treat any error as a failed load).
   - `maxPages` is a safety valve against an unbounded loop if a backend
     ever returns full pages forever.
*/
export async function fetchAllPaged(fetchPage, { pageSize = 1000, maxPages = 200 } = {}) {
  const rows = [];
  for (let page = 0, from = 0; page < maxPages; page++) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: rows, error };
    if (!data || data.length === 0) break; // empty page ⇒ end of set
    rows.push(...data);
    from += data.length;
  }
  return { data: rows, error: null };
}
