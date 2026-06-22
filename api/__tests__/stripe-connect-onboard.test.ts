import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

vi.mock("../_admin.js", () => ({
  getAuthUser: vi.fn(),
  getServiceClient: vi.fn(),
}));
vi.mock("../_sentry.js", () => ({
  withSentry: (h: Row) => h,
}));
vi.mock("../_stripe.js", () => ({
  createConnectAccount: vi.fn(),
  createAccountLink: vi.fn(),
}));

import handler from "../stripe-connect-onboard.js";
import { getAuthUser as getAuthUserRaw, getServiceClient as getServiceClientRaw } from "../_admin.js";
import { createConnectAccount as createConnectAccountRaw, createAccountLink as createAccountLinkRaw } from "../_stripe.js";

const getAuthUser = getAuthUserRaw as Row;
const getServiceClient = getServiceClientRaw as Row;
const createConnectAccount = createConnectAccountRaw as Row;
const createAccountLink = createAccountLinkRaw as Row;

function makeRes(): Row {
  const r: Row = {
    statusCode: 200,
    body: null,
    status(c: Row) { r.statusCode = c; return r; },
    json(b: Row) { r.body = b; return r; },
  };
  return r;
}

function makeReq() {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-jwt", origin: "https://cardigan.mx" },
    body: {},
  };
}

// Service client: returns a single therapist_connect_accounts row.
// `existing` controls whether the lookup hits an existing account.
// `insertCaptured` records what was passed to .insert() so we can
// assert first-time onboarding writes the right shape.
function makeServiceClient({ existing = null, insertCaptured = {}, insertError = null }: Row = {}) {
  return {
    from: () => ({
      select: () => ({
        eq() { return this; },
        async maybeSingle() { return { data: existing, error: null }; },
      }),
      insert(payload: Row) {
        insertCaptured.payload = payload;
        return Promise.resolve({ error: insertError });
      },
    }),
  };
}

beforeEach(() => {
  getAuthUser.mockReset();
  getServiceClient.mockReset();
  createConnectAccount.mockReset();
  createAccountLink.mockReset();
});

describe("POST /api/stripe-connect-onboard", () => {
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

  it("creates a new Connect account on first onboarding", async () => {
    getAuthUser.mockResolvedValue({
      id: "u-1",
      email: "doc@example.com",
      user_metadata: { full_name: "Dra. Mariana López" },
    });
    const captured: Row = {};
    getServiceClient.mockReturnValue(makeServiceClient({ existing: null, insertCaptured: captured }));
    createConnectAccount.mockResolvedValue({
      id: "acct_new123",
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
    createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.com/setup/test",
      expires_at: 1234567890,
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe("https://connect.stripe.com/setup/test");
    expect(res.body.account_id).toBe("acct_new123");
    expect(captured.payload.user_id).toBe("u-1");
    expect(captured.payload.stripe_account_id).toBe("acct_new123");
    expect(captured.payload.charges_enabled).toBe(false);
    // Account was created with the right caller info.
    const acctCall = createConnectAccount.mock.calls[0][0];
    expect(acctCall.email).toBe("doc@example.com");
    expect(acctCall.userId).toBe("u-1");
    expect(acctCall.fullName).toBe("Dra. Mariana López");
  });

  it("reuses an existing account on resume", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1", email: "doc@example.com" });
    const captured: Row = {};
    getServiceClient.mockReturnValue(makeServiceClient({
      existing: { stripe_account_id: "acct_existing" },
      insertCaptured: captured,
    }));
    createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.com/setup/test",
      expires_at: 1234567890,
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.account_id).toBe("acct_existing");
    // No new account created on resume.
    expect(createConnectAccount).not.toHaveBeenCalled();
    // No insert either.
    expect(captured.payload).toBeUndefined();
    // Account link minted against the existing acct id.
    const linkCall = createAccountLink.mock.calls[0][0];
    expect(linkCall.accountId).toBe("acct_existing");
  });

  it("survives a unique-violation on insert (concurrent first-call)", async () => {
    // Two tabs both fire onboarding. First wins the insert; second
    // hits 23505. We should still mint the Account Link and return
    // 200 — the user just sees onboarding start.
    getAuthUser.mockResolvedValue({ id: "u-1", email: "doc@example.com" });
    getServiceClient.mockReturnValue(makeServiceClient({
      existing: null,
      insertError: { code: "23505", message: "duplicate" },
    }));
    createConnectAccount.mockResolvedValue({
      id: "acct_new",
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
    createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.com/setup/test",
      expires_at: 1234567890,
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe("https://connect.stripe.com/setup/test");
  });

  it("uses incoming Origin to build return URLs (preview-safe)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1", email: "doc@example.com" });
    getServiceClient.mockReturnValue(makeServiceClient({
      existing: { stripe_account_id: "acct_x" },
    }));
    createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.com/setup/test",
      expires_at: 1234567890,
    });
    const req = makeReq();
    req.headers.origin = "https://preview-abc.vercel.app";
    const res = makeRes();
    await handler(req, res);
    const linkCall = createAccountLink.mock.calls[0][0];
    expect(linkCall.returnUrl).toContain("https://preview-abc.vercel.app/");
    expect(linkCall.refreshUrl).toContain("https://preview-abc.vercel.app/");
  });
});
