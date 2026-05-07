import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_admin.js", () => ({
  getAuthUser: vi.fn(),
}));
vi.mock("../_sentry.js", () => ({
  withSentry: (h) => h,
}));
vi.mock("../_r2.js", () => ({
  getR2: vi.fn(async () => ({})),
  BUCKET: "test-bucket",
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://presigned.example/test"),
}));
vi.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand: class { constructor(input) { Object.assign(this, input); } },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import handler from "../patient-upload-url.js";
import { getAuthUser } from "../_admin.js";
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
    headers: { authorization: "Bearer test-jwt" },
    body: {
      patient_id: "p-1",
      file_name: "examen.pdf",
      content_type: "application/pdf",
      ...body,
    },
  };
}

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

beforeEach(() => {
  getAuthUser.mockReset();
  createClient.mockReset();
});

describe("POST /api/patient-upload-url", () => {
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

  it("returns 400 on missing file_name", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ file_name: "" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on oversized file_name", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ file_name: "a".repeat(500) }), res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 415 on disallowed content type", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    const res = makeRes();
    await handler(makeReq({ content_type: "application/x-msdownload" }), res);
    expect(res.statusCode).toBe(415);
  });

  it("returns 403 when patient row is RLS-blocked (forged patient_id)", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 with url + path under therapist prefix on happy path", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      user_id: "therapist-99",
    }));
    const res = makeRes();
    await handler(makeReq({ file_name: "Mi Examen Médico.pdf" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe("https://presigned.example/test");
    // Path is server-built under the THERAPIST's id (not the patient's
    // auth.uid()) so R2 keys group with therapist-uploaded docs.
    expect(res.body.path).toMatch(/^therapist-99\/p-1\/patient-\d+-/);
    // Filename ends with extension matching the content type.
    expect(res.body.path.endsWith(".pdf")).toBe(true);
    // Slug strips accents + lowercases.
    expect(res.body.path).toContain("mi-examen-medico");
  });

  it("uses correct extension for image content types", async () => {
    getAuthUser.mockResolvedValue({ id: "u-1" });
    createClient.mockReturnValue(makeUserClient({
      id: "p-1",
      user_id: "therapist-99",
    }));
    const res = makeRes();
    await handler(makeReq({ content_type: "image/png", file_name: "credencial.png" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.path.endsWith(".png")).toBe(true);
  });
});
