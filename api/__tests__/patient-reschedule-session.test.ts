import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

vi.mock("../_admin.js", () => ({
  getAuthUser: vi.fn(),
  getServiceClient: vi.fn(),
}));
vi.mock("../_push.js", () => ({
  sendPush: vi.fn(),
  TERMINAL_PUSH_STATUSES: new Set([400, 404, 410]),
}));
vi.mock("../_sentry.js", () => ({
  withSentry: (h: Row) => h,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import handler from "../patient-reschedule-session.js";
import { getAuthUser as getAuthUserRaw, getServiceClient as getServiceClientRaw } from "../_admin.js";
import { sendPush as sendPushRaw } from "../_push.js";
import { createClient as createClientRaw } from "@supabase/supabase-js";

const getAuthUser = getAuthUserRaw as Row;
const getServiceClient = getServiceClientRaw as Row;
const sendPush = sendPushRaw as Row;
const createClient = createClientRaw as Row;

function makeRes(): Row {
  const r: Row = {
    statusCode: 200,
    body: null,
    status(c: Row) { r.statusCode = c; return r; },
    json(b: Row) { r.body = b; return r; },
  };
  return r;
}

// Build a future ISO date N days from now in yyyy-mm-dd. Used in
// happy-path bodies so the new_slot timestamp passes the past-check.
function futureIso(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeReq(overrides = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-jwt" },
    body: {
      session_id: "s-1",
      new_date: futureIso(7),
      new_time: "10:00",
      ...overrides,
    },
  };
}

// Future short-date in "D-MMM" form for the existing-session row.
// Mirrors how the real DB stores `date`.
function futureShortDate(days: number) {
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getDate()}-${months[d.getMonth()]}`;
}

function makeUserClient(sessionRow: Row, error = null) {
  return {
    from: () => ({
      select: () => ({
        eq() { return this; },
        async maybeSingle() { return { data: sessionRow, error }; },
      }),
    }),
  };
}

/* Service-role stub. The endpoint switched from "edit the session
   row" to "create a session_reschedule_requests row", so the stub
   needs to handle:
     1. SELECT sessions (conflict check)
     2. UPDATE session_reschedule_requests (withdraw any prior pending)
     3. INSERT session_reschedule_requests (the new pending row)
     4. SELECT push_subscriptions (best-effort therapist push)
     5. SELECT patients + auth.admin.getUserById (for emails)
   Tests pass canned responses for conflict + insert; everything else
   returns harmless empty results. */
function makeServiceClient({ conflict = null, insertResult, pushSubs = [] }: Row = {}) {
  return {
    from: (table: Row) => {
      if (table === "push_subscriptions") {
        return {
          select: () => ({
            eq() { return Promise.resolve({ data: pushSubs, error: null }); },
          }),
        };
      }
      if (table === "session_reschedule_requests") {
        return {
          // withdrawPendingForSession does .update(...).eq(...).eq(...).select(...)
          update: () => ({
            eq() { return this; },
            select() { return Promise.resolve({ data: [], error: null }); },
          }),
          // The insert chain: .insert(row).select(...).single()
          insert: () => ({
            select: () => ({
              single: async () => insertResult || {
                data: { id: "req-new", expires_at: new Date(Date.now() + 86400000).toISOString() },
                error: null,
              },
            }),
          }),
        };
      }
      if (table === "patients") {
        return {
          select: () => ({
            eq() { return this; },
            async maybeSingle() { return { data: { name: "Juana", email: null, parent: null }, error: null }; },
          }),
        };
      }
      // sessions table — used for the conflict select.
      return {
        select: () => ({
          eq() { return this; },
          neq() { return this; },
          async maybeSingle() { return { data: conflict, error: null }; },
        }),
        delete: () => ({
          eq() { return Promise.resolve({ error: null }); },
        }),
      };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: null } }, error: null }),
      },
    },
  };
}

beforeEach(() => {
  getAuthUser.mockReset();
  getServiceClient.mockReset();
  createClient.mockReset();
  sendPush.mockReset();
});

describe("POST /api/patient-reschedule-session", () => {
  it("returns 405 on non-POST", async () => {
    const res = makeRes();
    await handler({ method: "GET", headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 401 when not authenticated", async () => {
    getAuthUser.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 on missing session_id", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ session_id: undefined }), res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on bad time format", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ new_time: "25:99" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("bad_time");
  });

  it("returns 400 on bad date format", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ new_date: "2026/05/08" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("bad_date");
  });

  it("returns 400 on impossible date (Feb 30)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ new_date: "2026-02-30" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 too_far when new slot is more than 180 days out", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    // 200 days from now — past the year-fuzz storage horizon.
    const res = makeRes();
    await handler(makeReq({ new_date: futureIso(200) }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("too_far");
  });

  it("returns 403 when new slot is in the past", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    // Yesterday — should fail the past-target check before any DB hit.
    const past = new Date(Date.now() - 86_400_000);
    const y = past.getFullYear(); const m = String(past.getMonth()+1).padStart(2,"0"); const d = String(past.getDate()).padStart(2,"0");
    const res = makeRes();
    await handler(makeReq({ new_date: `${y}-${m}-${d}` }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("past_target");
  });

  it("returns 403 when session lookup is RLS-blocked", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when session is already cancelled", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "s-1", patient_id: "p-1", patient: "Juana",
      date: futureShortDate(2), time: "10:00",
      status: "cancelled", user_id: "t-1", duration: 60,
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("not_scheduled");
  });

  it("returns 403 when the CURRENT session is already in the past", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    // Current slot was yesterday — past_source.
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const d = new Date(Date.now() - 86_400_000);
    const past = `${d.getDate()}-${months[d.getMonth()]}`;
    createClient.mockReturnValue(makeUserClient({
      id: "s-1", patient_id: "p-1", patient: "Juana",
      date: past, time: "10:00",
      status: "scheduled", user_id: "t-1", duration: 60,
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("past_source");
  });

  it("returns 409 same_slot when the new slot equals the current slot", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const newIso = futureIso(7);
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const d = new Date(newIso + "T12:00:00");
    const sameShort = `${d.getDate()}-${months[d.getMonth()]}`;
    createClient.mockReturnValue(makeUserClient({
      id: "s-1", patient_id: "p-1", patient: "Juana",
      date: sameShort, time: "10:00",
      status: "scheduled", user_id: "t-1", duration: 60,
    }));
    const res = makeRes();
    await handler(makeReq({ new_date: newIso, new_time: "10:00" }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("same_slot");
  });

  it("returns 409 conflict when another session occupies the new slot", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "s-1", patient_id: "p-1", patient: "Juana",
      date: futureShortDate(2), time: "09:00",
      status: "scheduled", user_id: "t-1", duration: 60,
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      conflict: { id: "s-2" },          // another session at new slot
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("conflict");
  });

  it("returns 200 with a new pending request on the happy path", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "s-1", patient_id: "p-1", patient: "Juana",
      date: futureShortDate(2), time: "09:00",
      status: "scheduled", user_id: "t-1", duration: 60,
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      conflict: null,
      insertResult: {
        data: { id: "req-1", expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() },
        error: null,
      },
    }));
    const res = makeRes();
    await handler(makeReq({ new_date: futureIso(7), new_time: "10:00" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.request_id).toBe("req-1");
    expect(res.body.status).toBe("pending");
    expect(res.body.expires_at).toBeTruthy();
  });

  it("returns 500 if the insert into session_reschedule_requests fails", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "s-1", patient_id: "p-1", patient: "Juana",
      date: futureShortDate(2), time: "09:00",
      status: "scheduled", user_id: "t-1", duration: 60,
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      conflict: null,
      insertResult: { data: null, error: { message: "DB unavailable" } },
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
  });
});
