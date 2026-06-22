import { describe, it, expect, vi } from "vitest";

// useAuth.js imports ../supabaseClient at module load, which calls
// createClient with env-derived URLs that aren't set under vitest. We
// only need the pure classifyCaptchaError export, so stub the
// side-effectful imports to keep the module importable.
vi.mock("../../supabaseClient", () => ({ supabase: { auth: {} } }));
vi.mock("../../lib/platform", () => ({ isNative: () => false, isIOS: () => false }));
vi.mock("../../lib/nativeAppleSignIn", () => ({ signInWithAppleNative: vi.fn() }));
vi.mock("../../lib/nativeGoogleSignIn", () => ({ signInWithGoogleNative: vi.fn() }));
vi.mock("../../utils/inviteTokenStorage", () => ({
  clearInviteToken: vi.fn(),
  getInviteContext: vi.fn(),
}));

import { classifyCaptchaError } from "../useAuth";

/* The captcha classifier maps Supabase's captcha-required auth error to
   a typed { code: "captcha_enforced" } result so the failure is
   diagnosable instead of surfacing as a generic red string. This is the
   client half of the captcha-enforcement-off invariant (the server half
   lives in api/auth-config-check.js). See CLAUDE.md "Auth captcha". */
describe("classifyCaptchaError", () => {
  it("classifies the captcha_failed error code", () => {
    const out = classifyCaptchaError({ code: "captcha_failed", message: "boom" });
    expect(out).toEqual({ error: "boom", code: "captcha_enforced" });
  });

  it("classifies a captcha-mentioning message regardless of code", () => {
    const out = classifyCaptchaError({
      message: "captcha verification process failed",
    });
    expect(out?.code).toBe("captcha_enforced");
    expect(out?.error).toBe("captcha verification process failed");
  });

  it("is case-insensitive on the message", () => {
    const out = classifyCaptchaError({ message: "Captcha protection: invalid token" });
    expect(out?.code).toBe("captcha_enforced");
  });

  it("falls back to a default message when none is provided", () => {
    const out = classifyCaptchaError({ code: "captcha_failed" });
    expect(out?.code).toBe("captcha_enforced");
    expect(out?.error).toBe("Captcha verification failed");
  });

  it("returns null for unrelated auth errors (happy path untouched)", () => {
    expect(classifyCaptchaError({ message: "Invalid login credentials" })).toBeNull();
    expect(classifyCaptchaError({ code: "invalid_credentials", message: "nope" })).toBeNull();
    expect(classifyCaptchaError({ message: "Email not confirmed" })).toBeNull();
  });

  it("returns null for a falsy error", () => {
    expect(classifyCaptchaError(null)).toBeNull();
    expect(classifyCaptchaError(undefined)).toBeNull();
  });
});
