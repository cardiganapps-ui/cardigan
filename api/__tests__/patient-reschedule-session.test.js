import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import handler from "../patient-reschedule-session.js";
import { getAuthUser, getServiceClient } from "../_admin.js";
import { sendPush } from "../_push.js";
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

// Build a future ISO date N days from now in yyyy-mm-dd. Used in
// happy-path bodies so the new_slot timestamp passes the past-check.
function futureIso(days) {
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
function futureShortDate(days) {
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getDate()}-${months[d.getMonth()]}`;
}

function makeUserClient(sessionRow, error = null) {
  return {
    from: () => ({
      select: () => ({
        eq() { return this; },
        async maybeSingle() { return { data: sessionRow, error }; },
      }),
    }),
  };
}

/* The service-role path makes up to three calls per request:
   1. SELECT against sessions for the conflict check
   2. UPDATE against sessions for the atomic move
   3. SELECT against push_subscriptions (best-effort)
   The stub returns canned responses for the conflict + update paths
   (passed in by the test) and an empty push_subscriptions list. */
function makeServiceClient({ conflict = null, updateResult, pushSubs = [] } = {}) {
  return {
    from: (table) => {
      if (table === "push_subscriptions") {
        return {
          select: () => ({
            eq() { return Promise.resolve({ data: pushSubs, error: null }); },
          }),
        };
      }
      // sessions table — both select (conflict) and update.
      return {
        select: () => ({
          eq() { return this; },
          neq() { return this; },
          async maybeSingle() { return { data: conflict, error: null }; },
        }),
        update: () => ({
          eq() { return this; },
          select() { return this; },
          async maybeSingle() { return updateResult || { data: null, error: null }; },
        }),
        delete: () => ({
          eq() { return Promise.resolve({ error: null }); },
        }),
      };
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

  it("returns 200 on happy path with audit fields populated", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "s-1", patient_id: "p-1", patient: "Juana",
      date: futureShortDate(2), time: "09:00",
      status: "scheduled", user_id: "t-1", duration: 60,
    }));
    const newDateIso = futureIso(7);
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const d = new Date(newDateIso + "T12:00:00");
    const expectedShort = `${d.getDate()}-${months[d.getMonth()]}`;
    getServiceClient.mockReturnValue(makeServiceClient({
      conflict: null,
      updateResult: { data: { id: "s-1", date: expectedShort, time: "10:00", day: "Lunes", patient: "Juana" }, error: null },
    }));
    const res = makeRes();
    await handler(makeReq({ new_date: newDateIso, new_time: "10:00" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.session_id).toBe("s-1");
    expect(res.body.date).toBe(expectedShort);
    expect(res.body.time).toBe("10:00");
    expect(res.body.last_rescheduled_at).toBeTruthy();
  });

  it("returns 409 race_lost when the atomic update finds no row", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "s-1", patient_id: "p-1", patient: "Juana",
      date: futureShortDate(2), time: "09:00",
      status: "scheduled", user_id: "t-1", duration: 60,
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      conflict: null,
      updateResult: { data: null, error: null }, // 0 rows → race lost
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("race_lost");
  });
});
