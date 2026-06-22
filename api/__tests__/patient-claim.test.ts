import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// Mock _admin's auth + service-client helpers BEFORE importing the
// handler. The handler reads getAuthUser() + getServiceClient() at
// call time, so the mocks just need to be in place by import.
vi.mock("../_admin.js", () => ({
  getAuthUser: vi.fn(),
  getServiceClient: vi.fn(),
}));
vi.mock("../_sentry.js", () => ({
  withSentry: (h: Row) => h,
}));
// The handler now runs the per-endpoint rate-limit guard up front.
// These tests exercise the claim logic, not the limiter, so stub it to
// a pass-through (the limiter itself is covered by its own test).
vi.mock("../_ratelimit.js", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 99, retryAfter: 0 }),
}));

import claimHandler from "../patient-claim.js";
import { getAuthUser as getAuthUserRaw, getServiceClient as getServiceClientRaw } from "../_admin.js";

const getAuthUser = getAuthUserRaw as Row;
const getServiceClient = getServiceClientRaw as Row;

/* The claim handler walks a 5-step query chain — lookup, atomic
   claim, atomic stamp, rollback on stamp-fail, existence-re-check.
   The test stub records every step and returns canned responses
   for the cases we want to assert. Each test wires its own
   responses; the helper below captures the chain pattern.

   Query shapes the handler expects:
     1. .from("patient_invites").select(...).eq("token_hash", h).maybeSingle()
     2. .from("patient_invites").update(...).eq("id", id).is("used_at", null).select("id").maybeSingle()
     3. .from("patients").update(...).eq("id", id).is("patient_user_id", null).select("id").maybeSingle()
     4. .from("patient_invites").update(...).eq("id", id)        // rollback
     5. .from("patients").select(...).eq("id", id).maybeSingle()  // existence re-check */

function makeRes(): Row {
  const r: Row = {
    statusCode: 200,
    body: null,
    status(c: Row) { r.statusCode = c; return r; },
    json(b: Row) { r.body = b; return r; },
  };
  return r;
}

function makeReq(token = "tok") {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-jwt" },
    body: { token },
  };
}

/* Build a Supabase stub that returns sequential responses keyed by
   table + first-method. Each test seeds the responses list; the
   stub pops in order.

   Shape of a response entry:
     { table, op: "select"|"update", result: { data, error } }

   The chain methods (.eq, .is, .select, .maybeSingle) all return
   the same builder object with a `_resolve()` that delivers the
   stored result when terminal (.maybeSingle / .select for terminal
   selects). */
function makeServiceStub(responses: Row) {
  const queue = [...responses];
  const calls: Row[] = [];
  function builder(table: Row, op: Row) {
    // Only consume the queue on terminal `maybeSingle`. Chains that
    // don't terminate (the rollback path, which is just .update().eq()
    // followed by `await`) MUST NOT consume — otherwise they'd eat a
    // response intended for the next chain.
    const node = {
      eq() { return node; },
      is() { return node; },
      select() { return node; },
      async maybeSingle() {
        const r = queue.shift() || { data: null, error: null };
        calls.push({ table, op, terminal: "maybeSingle" });
        return r;
      },
      // Awaitable for the rollback path. Doesn't consume the queue
      // — the rollback always resolves with { error: null }.
      then(onFulfilled: Row) {
        calls.push({ table, op, terminal: "await" });
        return Promise.resolve({ error: null }).then(onFulfilled);
      },
    };
    return node;
  }
  return {
    calls,
    auth: {
      // Some claim paths re-fetch — keep the stub simple.
      admin: { getUserById: async () => ({ data: { user: null } }) },
    },
    from(table: Row) {
      return {
        select() { return builder(table, "select"); },
        update() { return builder(table, "update"); },
      };
    },
  };
}

beforeEach(() => {
  getAuthUser.mockReset();
  getServiceClient.mockReset();
});

describe("POST /api/patient-claim", () => {
  it("returns 401 when not authenticated", async () => {
    getAuthUser.mockResolvedValue(null);
    const req = makeReq();
    const res = makeRes();
    await claimHandler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 on missing token", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const req = { method: "POST", headers: {}, body: {} };
    const res = makeRes();
    await claimHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 405 on non-POST", async () => {
    const req = { method: "GET", headers: {}, body: {} };
    const res = makeRes();
    await claimHandler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 404 when token doesn't exist", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    getServiceClient.mockReturnValue(makeServiceStub([
      { data: null, error: null }, // step 1: lookup → not found
    ]));
    const res = makeRes();
    await claimHandler(makeReq("missing-token"), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("returns 409 when token already used", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    getServiceClient.mockReturnValue(makeServiceStub([
      {
        data: {
          id: "inv-1",
          patient_id: "p-1",
          therapist_id: "t-1",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          used_at: new Date().toISOString(),
        },
        error: null,
      },
    ]));
    const res = makeRes();
    await claimHandler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("already_used");
  });

  it("returns 410 when token expired", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    getServiceClient.mockReturnValue(makeServiceStub([
      {
        data: {
          id: "inv-1",
          patient_id: "p-1",
          therapist_id: "t-1",
          expires_at: new Date(Date.now() - 86_400_000).toISOString(), // yesterday
          used_at: null,
        },
        error: null,
      },
    ]));
    const res = makeRes();
    await claimHandler(makeReq(), res);
    expect(res.statusCode).toBe(410);
    expect(res.body.code).toBe("expired");
  });

  it("returns 200 on happy path with patient_id + therapist_user_id", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    getServiceClient.mockReturnValue(makeServiceStub([
      // 1: lookup → valid pending invite
      {
        data: {
          id: "inv-1",
          patient_id: "p-1",
          therapist_id: "t-1",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          used_at: null,
        },
        error: null,
      },
      // 2: claim → won
      { data: { id: "inv-1" }, error: null },
      // 3: stamp → won
      { data: { id: "p-1" }, error: null },
    ]));
    const res = makeRes();
    await claimHandler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.patient_id).toBe("p-1");
    expect(res.body.therapist_user_id).toBe("t-1");
  });

  it("returns 409 race_lost when claim update finds no row", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    getServiceClient.mockReturnValue(makeServiceStub([
      // 1: lookup → valid
      {
        data: {
          id: "inv-1",
          patient_id: "p-1",
          therapist_id: "t-1",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          used_at: null,
        },
        error: null,
      },
      // 2: claim → 0 rows (someone else won the race)
      { data: null, error: null },
    ]));
    const res = makeRes();
    await claimHandler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("race_lost");
  });

  it("returns 404 patient_gone when patient row was deleted between invite + claim", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    getServiceClient.mockReturnValue(makeServiceStub([
      // 1: lookup → valid
      {
        data: {
          id: "inv-1",
          patient_id: "p-gone",
          therapist_id: "t-1",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          used_at: null,
        },
        error: null,
      },
      // 2: claim → won
      { data: { id: "inv-1" }, error: null },
      // 3: stamp → 0 rows (patient row gone OR already linked)
      { data: null, error: null },
      // 4: rollback (no resp shape needed; the stub's then() handles it)
      // 5: existence re-check → not found
      { data: null, error: null },
    ]));
    const res = makeRes();
    await claimHandler(makeReq(), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe("patient_gone");
  });

  it("returns 409 patient_linked when patient row exists but already linked", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    getServiceClient.mockReturnValue(makeServiceStub([
      {
        data: {
          id: "inv-1",
          patient_id: "p-1",
          therapist_id: "t-1",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          used_at: null,
        },
        error: null,
      },
      { data: { id: "inv-1" }, error: null },         // claim won
      { data: null, error: null },                     // stamp 0 rows
      // 5: existence re-check → row exists (so it's linked, not gone)
      { data: { id: "p-1", patient_user_id: "u-other" }, error: null },
    ]));
    const res = makeRes();
    await claimHandler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("patient_linked");
  });
});
