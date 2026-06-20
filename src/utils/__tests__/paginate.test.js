import { describe, it, expect, vi } from "vitest";
import { fetchAllPaged } from "../paginate";

// A fake page source backed by an in-memory array. Mirrors PostgREST's
// inclusive .range(from, to) semantics AND its server-side max_rows cap:
// a request can never return more than `serverCap` rows even if a wider
// range is asked for. This is what makes pagination non-trivial — a
// `.limit(10000)` silently tops out at the cap.
function makeSource(total, { serverCap = 1000 } = {}) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  const fetchPage = vi.fn(async (from, to) => {
    const end = Math.min(to + 1, from + serverCap);
    return { data: all.slice(from, end), error: null };
  });
  return { all, fetchPage };
}

describe("fetchAllPaged", () => {
  it("returns every row across multiple full pages (the >cap case)", async () => {
    // 2500 rows, server caps at 1000 → 1000 + 1000 + 500, then an empty page.
    const { all, fetchPage } = makeSource(2500, { serverCap: 1000 });
    const { data, error } = await fetchAllPaged(fetchPage, { pageSize: 1000 });
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data).toEqual(all);
    expect(fetchPage).toHaveBeenCalledTimes(4); // 3 data pages + 1 empty terminator
  });

  it("fetches a sub-page set (under one page of data)", async () => {
    const { fetchPage } = makeSource(200, { serverCap: 1000 });
    const res = await fetchAllPaged(fetchPage, { pageSize: 1000 });
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(200);
    expect(fetchPage).toHaveBeenCalledTimes(2); // 200 rows, then empty page
  });

  it("handles an exact multiple of the page size", async () => {
    // 2000 rows, pageSize 1000 → two full pages, then a third empty page
    // tells us we're done (no short page to signal the end).
    const { fetchPage } = makeSource(2000, { serverCap: 1000 });
    const { data } = await fetchAllPaged(fetchPage, { pageSize: 1000 });
    expect(data).toHaveLength(2000);
    expect(fetchPage).toHaveBeenCalledTimes(3); // 1000, 1000, then empty
  });

  it("stays aligned (and complete) when the server cap is smaller than the page", async () => {
    // The critical anti-truncation property: we ask for 1000 but the server
    // only ever returns 300. Because we advance by the ACTUAL rows returned
    // and stop ONLY on an empty page (never on a short page), we still get
    // all 700 — no row is silently dropped.
    const { all, fetchPage } = makeSource(700, { serverCap: 300 });
    const { data } = await fetchAllPaged(fetchPage, { pageSize: 1000 });
    expect(data).toEqual(all);
    expect(data).toHaveLength(700);
    expect(fetchPage).toHaveBeenCalledTimes(4); // 300, 300, 100, then empty
  });

  it("returns the partial set plus the error when a page fails", async () => {
    const all = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    let n = 0;
    const fetchPage = vi.fn(async (from, to) => {
      if (n++ === 1) return { data: null, error: { message: "boom" } };
      return { data: all.slice(from, Math.min(to + 1, from + 1000)), error: null };
    });
    const { data, error } = await fetchAllPaged(fetchPage, { pageSize: 1000 });
    expect(error).toEqual({ message: "boom" });
    expect(data).toHaveLength(1000); // first page accumulated before the failure
  });

  it("respects the maxPages safety valve against an infinite source", async () => {
    // A pathological source that always returns a full page never signals an
    // end. maxPages bounds the loop so a backend bug can't hang the app.
    const fetchPage = vi.fn(async (from) =>
      ({ data: Array.from({ length: 1000 }, (_, i) => ({ id: from + i })), error: null })
    );
    const { data } = await fetchAllPaged(fetchPage, { pageSize: 1000, maxPages: 3 });
    expect(data).toHaveLength(3000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
