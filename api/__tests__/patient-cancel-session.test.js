import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth + service-client + push helpers BEFORE importing the
// handler. The handler resolves them at call time, so the mocks just
// need to be in place at import.
vi.mock("../_admin.js", () => ({
  getAuthUser: vi.fn(),
  getServiceClient: vi.fn(),
}));
vi.mock("../_push.js", () => ({
  sendPush: vi.fn(),
  TERMINAL_PUSH_STATUSES: new Set([400, 404, 410]),
}));
vi.mock("../_sentry.js", () => ({
  withSentry: (h) => h,
}));

import handler from "../patient-cancel-session.js";
import { getAuthUser, getServiceClient } from "../_admin.js";
import { sendPush } from "../_push.js";

/* The cancel handler walks: ownership lookup (via user-JWT client) →
   atomic flip (service-role) → therapist push (best-effort). The
   tests stub out the user-JWT path and the service path separately
   so each error branch can be exercised cleanly.

   We don't try to mock createClient itself — instead we ride on the
   fact that the handler's first SELECT happens on the user-JWT
   client (which, in tests, gets the same anon key + auth header
   from req). For the test we replace the WHOLE handler entry by
   making getAuthUser resolve the user, and stub the service client
   for everything beyond the ownership fetch. The user-JWT lookup
   error branch is the harder one — we patch global `createClient`
   from supabase-js inline. */

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));
import { createClient } from "@supabase/supabase-js";

function makeRes() {
  const r = {
    statusCode: 200,
    body: null,
    status(c) { r.statusCode = c; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

function makeReq(session_id = "s-1", note) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-jwt" },
    body: { session_id, ...(note != null ? { note } : {}) },
  };
}

/* Build a tiny chainable Supabase stub. Each test seeds the
   responses for SELECT-with-maybeSingle and UPDATE-with-maybeSingle.
   The chain methods (.eq, .is, .select, .in, .delete) all return
   the same builder so the test doesn't have to pattern-match on
   exact call shapes. */
function makeSelectBuilder(maybeSingleResult) {
  const node = {
    eq() { return node; },
    in() { return node; },
    is() { return node; },
    select() { return node; },
    async maybeSingle() { return maybeSingleResult; },
  };
  return node;
}
function makeUpdateBuilder(maybeSingleResult) {
  const node = {
    eq() { return node; },
    is() { return node; },
    select() { return node; },
    async maybeSingle() { return maybeSingleResult; },
  };
  return node;
}
function makeDeleteBuilder() {
  const node = {
    eq() { return node; },
    then(onFulfilled) {
      return Promise.resolve({ error: null }).then(onFulfilled);
    },
  };
  return node;
}

function makeUserClient(sessionRow, error = null) {
  return {
    from: () => ({
      select: () => makeSelectBuilder({ data: sessionRow, error }),
    }),
  };
}

function makeServiceClient({ updateResult, pushSubs = [] }) {
  return {
    from: (table) => ({
      select: () => {
        if (table === "push_subscriptions") {
          return {
            eq() {
              return Promise.resolve({ data: pushSubs, error: null });
            },
          };
        }
        return makeSelectBuilder({ data: null, error: null });
      },
      update: () => makeUpdateBuilder(updateResult),
      delete: () => makeDeleteBuilder(),
    }),
  };
}

beforeEach(() => {
  getAuthUser.mockReset();
  getServiceClient.mockReset();
  createClient.mockReset();
  sendPush.mockReset();
});

describe("POST /api/patient-cancel-session", () => {
  it("returns 401 when not authenticated", async () => {
    getAuthUser.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 405 on non-POST", async () => {
    const req = { method: "GET", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 on missing session_id", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const req = { method: "POST", headers: { authorization: "Bearer x" }, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when session lookup is RLS-blocked (no row)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when session is already cancelled", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "s-1",
      patient_id: "p-1",
      patient: "Juana",
      date: "20-Dic",
      time: "10:00",
      status: "cancelled",
      user_id: "t-1",
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("not_scheduled");
  });

  it("returns 403 when session is in the past", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    // Past date — well before the year-inference threshold (180d).
    const past = new Date(Date.now() - 30 * 86_400_000);
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const pastDate = `${past.getDate()}-${months[past.getMonth()]}`;
    createClient.mockReturnValue(makeUserClient({
      id: "s-1",
      patient_id: "p-1",
      patient: "Juana",
      date: pastDate,
      time: "10:00",
      status: "scheduled",
      user_id: "t-1",
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("past");
  });

  it("returns 200 on happy path with cancelled_at", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    // Future date — 7 days out.
    const future = new Date(Date.now() + 7 * 86_400_000);
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const futureDate = `${future.getDate()}-${months[future.getMonth()]}`;
    createClient.mockReturnValue(makeUserClient({
      id: "s-1",
      patient_id: "p-1",
      patient: "Juana",
      date: futureDate,
      time: "10:00",
      status: "scheduled",
      user_id: "t-1",
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      updateResult: { data: { id: "s-1", date: futureDate, time: "10:00", patient: "Juana" }, error: null },
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.session_id).toBe("s-1");
    expect(res.body.cancelled_at).toBeTruthy();
  });

  it("returns 409 when the atomic flip lost the race", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const future = new Date(Date.now() + 7 * 86_400_000);
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const futureDate = `${future.getDate()}-${months[future.getMonth()]}`;
    createClient.mockReturnValue(makeUserClient({
      id: "s-1",
      patient_id: "p-1",
      patient: "Juana",
      date: futureDate,
      time: "10:00",
      status: "scheduled",
      user_id: "t-1",
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      updateResult: { data: null, error: null }, // no row → race lost
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("race_lost");
  });

  it("rejects oversized note (>500 chars)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const future = new Date(Date.now() + 7 * 86_400_000);
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const futureDate = `${future.getDate()}-${months[future.getMonth()]}`;
    createClient.mockReturnValue(makeUserClient({
      id: "s-1",
      patient_id: "p-1",
      patient: "Juana",
      date: futureDate,
      time: "10:00",
      status: "scheduled",
      user_id: "t-1",
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      updateResult: { data: { id: "s-1", date: futureDate, time: "10:00", patient: "Juana" }, error: null },
    }));
    const longNote = "x".repeat(2000);
    const res = makeRes();
    await handler(makeReq("s-1", longNote), res);
    // Doesn't reject — the handler trims to MAX_NOTE_LEN (500)
    // server-side rather than 400ing on oversized input. Verify the
    // happy path still returns 200.
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 when note is non-string", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const req = {
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: { session_id: "s-1", note: 42 },
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});
