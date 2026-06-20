import { describe, it, expect, vi, beforeEach } from "vitest";

/* Asserts the per-endpoint rate-limit guard short-circuits with a 429
   (and the standard { error } shape + Retry-After header) BEFORE the
   handler does any DB work. Mock the limiter so we can drive the
   over-limit branch deterministically without a real Postgres window. */
vi.mock("../_ratelimit.js", () => ({
  rateLimit: vi.fn(),
}));
vi.mock("../_r2.js", () => ({
  getAuthUser: vi.fn(),
}));
vi.mock("../_admin.js", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("../_sentry.js", () => ({
  withSentry: (h) => h,
}));

import handler from "../record-consent.js";
import { rateLimit } from "../_ratelimit.js";
import { getAuthUser } from "../_r2.js";
import { getServiceClient } from "../_admin.js";

function makeRes() {
  const r = {
    statusCode: 200,
    body: null,
    headers: {},
    status(c) { r.statusCode = c; return r; },
    json(b) { r.body = b; return r; },
    setHeader(k, v) { r.headers[k] = v; return r; },
  };
  return r;
}

function makeReq() {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-jwt" },
    body: { policy_version: "2026.1" },
  };
}

beforeEach(() => {
  rateLimit.mockReset();
  getAuthUser.mockReset();
  getServiceClient.mockReset();
});

describe("POST /api/record-consent rate limiting", () => {
  it("returns 429 with Retry-After when over the limit, without touching the DB", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 60 });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(429);
    expect(res.body).toHaveProperty("error");
    expect(res.headers["Retry-After"]).toBe("60");
    // The guard must run before any service-client work.
    expect(getServiceClient).not.toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "record-consent", bucket: "u-1" })
    );
  });

  it("proceeds past the guard when under the limit", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    rateLimit.mockResolvedValue({ ok: true, remaining: 29, retryAfter: 0 });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    getServiceClient.mockReturnValue({ from: () => ({ upsert }) });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(getServiceClient).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalled();
  });
});
