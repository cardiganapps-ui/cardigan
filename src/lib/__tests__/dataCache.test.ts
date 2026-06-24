// @vitest-environment happy-dom
//
// Unit coverage for the localStorage stale-while-revalidate cache. Exercises
// the invalidation layers added in WS-13: explicit sign-out clear, the
// deploy-id (appVer) stamp, and the 24h max-age — plus the pre-existing uid
// guard and round-trip. Runs in happy-dom for a real localStorage.

import { describe, it, expect, beforeEach } from "vitest";
import { loadCachedData, saveCachedData, clearCachedData } from "../dataCache";

const UID = "user-123";
const KEY = `cardigan.cache.v1.${UID}`;
const DAY_MS = 24 * 60 * 60 * 1000;

// Read the stored payload, mutate it, write it back. Lets a test target one
// rejection reason while keeping every other field (notably the build's real
// appVer) valid — so we don't couple the test to the "dev" fallback value.
function patchStored(mutate: (p: Record<string, unknown>) => void) {
  const raw = localStorage.getItem(KEY);
  if (!raw) throw new Error("no snapshot stored");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  mutate(parsed);
  localStorage.setItem(KEY, JSON.stringify(parsed));
}

describe("dataCache", () => {
  beforeEach(() => { localStorage.clear(); });

  it("round-trips a saved snapshot", () => {
    saveCachedData(UID, { patients: [{ id: "p1" }], payments: [{ id: "m1" }] });
    const out = loadCachedData(UID);
    expect(out).not.toBeNull();
    expect((out as Record<string, unknown>).patients).toEqual([{ id: "p1" }]);
    expect((out as Record<string, unknown>).payments).toEqual([{ id: "m1" }]);
  });

  it("returns null with no userId and when nothing is stored", () => {
    expect(loadCachedData(null)).toBeNull();
    expect(loadCachedData(UID)).toBeNull();
  });

  it("clearCachedData removes the user's slot (sign-out leak fix)", () => {
    saveCachedData(UID, { patients: [{ id: "p1" }] });
    expect(localStorage.getItem(KEY)).not.toBeNull();
    clearCachedData(UID);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadCachedData(UID)).toBeNull();
  });

  it("rejects a snapshot whose embedded uid doesn't match the key", () => {
    saveCachedData(UID, { patients: [{ id: "p1" }] });
    patchStored(p => { p.uid = "someone-else"; });
    expect(loadCachedData(UID)).toBeNull();
  });

  it("rejects a snapshot written by a different build (appVer mismatch)", () => {
    saveCachedData(UID, { patients: [{ id: "p1" }] });
    patchStored(p => { p.appVer = "a-stale-deploy-id"; });
    expect(loadCachedData(UID)).toBeNull();
  });

  it("rejects a snapshot older than the 24h TTL", () => {
    saveCachedData(UID, { patients: [{ id: "p1" }] });
    patchStored(p => { p.ts = Date.now() - (DAY_MS + 60_000); });
    expect(loadCachedData(UID)).toBeNull();
  });

  it("accepts a snapshot within the 24h TTL", () => {
    saveCachedData(UID, { patients: [{ id: "p1" }] });
    patchStored(p => { p.ts = Date.now() - 60_000; });
    expect(loadCachedData(UID)).not.toBeNull();
  });
});
