import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock _admin's auth + service-client helpers and _stripe's checkout
// helper BEFORE importing the handler. The handler resolves them at
// call time, so the mocks just need to be in place at import.
vi.mock("../_admin.js", () => ({
  getAuthUser: vi.fn(),
  getServiceClient: vi.fn(),
}));
vi.mock("../_sentry.js", () => ({
  withSentry: (h) => h,
}));
vi.mock("../_stripe.js", () => ({
  createPatientCheckoutSession: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import handler from "../patient-create-checkout.js";
import { getAuthUser, getServiceClient } from "../_admin.js";
import { createPatientCheckoutSession } from "../_stripe.js";
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

function makeReq(body = {}) {
  return {
    method: "POST",
    headers: {
      authorization: "Bearer test-jwt",
      origin: "https://cardigan.mx",
    },
    body: { patient_id: "p-1", amount_cents: 50000, ...body },
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

// Service-role client: returns the requested Connect-account row +
// records the patient_payment_intents insert payload so tests can
// assert the ledger was updated correctly.
function makeServiceClient({ tca, captured = {}, insertError = null } = {}) {
  return {
    from: (table) => {
      if (table === "therapist_connect_accounts") {
        return {
          select: () => ({
            eq() { return this; },
            async maybeSingle() { return { data: tca, error: null }; },
          }),
        };
      }
      if (table === "patient_payment_intents") {
        return {
          insert(payload) {
            captured.payload = payload;
            return Promise.resolve({ error: insertError });
          },
        };
      }
      return { select: () => ({ eq() { return this; }, async maybeSingle() { return { data: null, error: null }; } }) };
    },
  };
}

beforeEach(() => {
  getAuthUser.mockReset();
  getServiceClient.mockReset();
  createClient.mockReset();
  createPatientCheckoutSession.mockReset();
});

describe("POST /api/patient-create-checkout", () => {
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
    await handler(makeReq({ patient_id: undefined }), res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when amount is below the floor (20 MXN)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ amount_cents: 500 }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("out_of_range");
  });

  it("returns 400 when amount is above the ceiling (50,000 MXN)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ amount_cents: 99_999_99 }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("out_of_range");
  });

  it("returns 400 when amount isn't a whole number", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ amount_cents: 50000.5 }), res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when patient row is RLS-blocked", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when therapist hasn't enabled online payments", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      user_id: "therapist-1",
      name: "Juana",
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      tca: null, // no Connect account
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("not_enabled");
  });

  it("returns 409 when Connect account exists but charges_enabled is false", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      user_id: "therapist-1",
      name: "Juana",
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      tca: { stripe_account_id: "acct_abc", charges_enabled: false },
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("not_enabled");
  });

  it("returns 200 + url + ledgers a row on happy path", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1", email: "patient@example.com" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      user_id: "therapist-1",
      name: "Juana",
    }));
    const captured = {};
    getServiceClient.mockReturnValue(makeServiceClient({
      tca: { stripe_account_id: "acct_abc", charges_enabled: true },
      captured,
    }));
    createPatientCheckoutSession.mockResolvedValue({
      id: "cs_test",
      url: "https://checkout.stripe.com/test",
      payment_intent: "pi_test_123",
    });
    const res = makeRes();
    await handler(makeReq({ amount_cents: 50000 }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe("https://checkout.stripe.com/test");
    expect(res.body.payment_intent_id).toBe("pi_test_123");
    // Ledger row recorded with the right shape.
    expect(captured.payload.patient_id).toBe("p-1");
    expect(captured.payload.therapist_user_id).toBe("therapist-1");
    expect(captured.payload.paid_by_user_id).toBe("u-1");
    expect(captured.payload.amount_cents).toBe(50000);
    expect(captured.payload.stripe_payment_intent_id).toBe("pi_test_123");
    expect(captured.payload.stripe_account_id).toBe("acct_abc");
    expect(captured.payload.status).toBe("pending");
  });

  it("forwards Stripe call with destination acct via stripeAccount param", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1", email: "patient@example.com" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      user_id: "therapist-1",
      name: "Juana",
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      tca: { stripe_account_id: "acct_xyz", charges_enabled: true },
    }));
    createPatientCheckoutSession.mockResolvedValue({
      id: "cs_x",
      url: "https://checkout.stripe.com/x",
      payment_intent: "pi_x",
    });
    const res = makeRes();
    await handler(makeReq({ amount_cents: 30000 }), res);
    expect(res.statusCode).toBe(200);
    const call = createPatientCheckoutSession.mock.calls[0][0];
    expect(call.accountId).toBe("acct_xyz");
    expect(call.amountCents).toBe(30000);
    expect(call.customerEmail).toBe("patient@example.com");
    expect(call.metadata.cardigan_kind).toBe("patient_payment");
    expect(call.metadata.patient_id).toBe("p-1");
    expect(call.metadata.therapist_user_id).toBe("therapist-1");
    expect(call.metadata.paid_by_user_id).toBe("u-1");
  });

  it("tolerates unique-violation on ledger insert (idempotent retry)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1", email: "patient@example.com" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      user_id: "therapist-1",
      name: "Juana",
    }));
    getServiceClient.mockReturnValue(makeServiceClient({
      tca: { stripe_account_id: "acct_abc", charges_enabled: true },
      insertError: { code: "23505", message: "duplicate" },
    }));
    createPatientCheckoutSession.mockResolvedValue({
      id: "cs_test",
      url: "https://checkout.stripe.com/test",
      payment_intent: "pi_test_123",
    });
    const res = makeRes();
    await handler(makeReq({ amount_cents: 50000 }), res);
    // 23505 is treated as "we already had this PI from a same-bucket
    // idempotency-key retry" — the response is still 200 with the URL.
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe("https://checkout.stripe.com/test");
  });
});
