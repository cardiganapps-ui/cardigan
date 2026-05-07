import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock _admin's auth + service-client helpers BEFORE importing the
// handler. The handler resolves them at call time, so the mocks just
// need to be in place at import.
vi.mock("../_admin.js", () => ({
  getAuthUser: vi.fn(),
  getServiceClient: vi.fn(),
}));
vi.mock("../_sentry.js", () => ({
  withSentry: (h) => h,
}));

// The handler builds a user-JWT'd Supabase client inline via
// createClient — mock the module so we can inject canned ownership
// responses without touching the network.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import handler from "../patient-intake.js";
import { getAuthUser, getServiceClient } from "../_admin.js";
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

function makeReq(body) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-jwt" },
    body: { patient_id: "p-1", consent: true, ...body },
  };
}

// User-JWT'd client: a single SELECT against patients gated by RLS.
function makeUserClient(patientRow, error = null) {
  return {
    from: () => ({
      select: () => ({
        eq() { return this; },
        async maybeSingle() { return { data: patientRow, error }; },
      }),
    }),
  };
}

// Service-role client: captures the UPDATE payload so tests can
// assert which columns were touched.
function makeServiceClient({ updateError = null, captured } = {}) {
  return {
    from: () => ({
      update(payload) {
        if (captured) captured.payload = payload;
        return {
          eq() { return Promise.resolve({ error: updateError }); },
        };
      },
    }),
  };
}

beforeEach(() => {
  getAuthUser.mockReset();
  getServiceClient.mockReset();
  createClient.mockReset();
});

describe("POST /api/patient-intake", () => {
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

  it("returns 400 on missing patient_id", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler({ method: "POST", headers: {}, body: { consent: true } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when consent is not explicitly true", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(
      { method: "POST", headers: {}, body: { patient_id: "p-1", consent: false } },
      res
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when the patient row is RLS-blocked (forged patient_id)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    // RLS returns no row for a patient the user doesn't own.
    createClient.mockReturnValue(makeUserClient(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 on first-time submit and stamps completed_at", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      patient_intake_completed_at: null,
    }));
    const captured = {};
    getServiceClient.mockReturnValue(makeServiceClient({ captured }));
    const res = makeRes();
    await handler(makeReq({
      birthdate: "1990-05-15",
      allergies: "polen",
      medical_conditions: "ninguna",
      height_cm: 170,
      goal_weight_kg: 65,
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    // Stamps timestamp on first submit.
    expect(captured.payload.patient_intake_completed_at).toBeTruthy();
    expect(captured.payload.allergies).toBe("polen");
    expect(captured.payload.height_cm).toBe(170);
  });

  it("preserves the original completed_at on resubmit (idempotent)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const original = "2026-01-01T12:00:00.000Z";
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      patient_intake_completed_at: original,
    }));
    const captured = {};
    getServiceClient.mockReturnValue(makeServiceClient({ captured }));
    const res = makeRes();
    await handler(makeReq({ allergies: "actualizado" }), res);
    expect(res.statusCode).toBe(200);
    // Timestamp NOT re-stamped on resubmit.
    expect(captured.payload.patient_intake_completed_at).toBeUndefined();
    // But other columns still update.
    expect(captured.payload.allergies).toBe("actualizado");
    // Response surfaces the ORIGINAL completed_at.
    expect(res.body.completed_at).toBe(original);
  });

  it("drops null values so empty fields don't overwrite therapist data", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      patient_intake_completed_at: null,
    }));
    const captured = {};
    getServiceClient.mockReturnValue(makeServiceClient({ captured }));
    const res = makeRes();
    await handler(makeReq({ allergies: "polen" }), res);
    expect(res.statusCode).toBe(200);
    expect(captured.payload.allergies).toBe("polen");
    // medical_conditions wasn't supplied → must NOT appear in payload.
    expect("medical_conditions" in captured.payload).toBe(false);
    expect("birthdate" in captured.payload).toBe(false);
    expect("height_cm" in captured.payload).toBe(false);
  });

  it("rejects out-of-range numeric fields by dropping them", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      patient_intake_completed_at: null,
    }));
    const captured = {};
    getServiceClient.mockReturnValue(makeServiceClient({ captured }));
    const res = makeRes();
    await handler(makeReq({
      height_cm: 9999, // > max
      goal_weight_kg: -5, // < min
      allergies: "polen",
    }), res);
    expect(res.statusCode).toBe(200);
    // Out-of-range numbers are clamped to null then dropped.
    expect("height_cm" in captured.payload).toBe(false);
    expect("goal_weight_kg" in captured.payload).toBe(false);
    // Valid string field still flows through.
    expect(captured.payload.allergies).toBe("polen");
  });

  it("rejects malformed birthdate by dropping it", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      patient_intake_completed_at: null,
    }));
    const captured = {};
    getServiceClient.mockReturnValue(makeServiceClient({ captured }));
    const res = makeRes();
    await handler(makeReq({ birthdate: "not-a-date", allergies: "x" }), res);
    expect(res.statusCode).toBe(200);
    expect("birthdate" in captured.payload).toBe(false);
  });

  it("rejects future birthdate by dropping it", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      patient_intake_completed_at: null,
    }));
    const captured = {};
    getServiceClient.mockReturnValue(makeServiceClient({ captured }));
    const res = makeRes();
    await handler(makeReq({ birthdate: "2999-01-01", allergies: "x" }), res);
    expect(res.statusCode).toBe(200);
    expect("birthdate" in captured.payload).toBe(false);
  });
});
