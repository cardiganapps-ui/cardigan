import { describe, it, expect } from "vitest";
import { isAllowedOrigin, safeAppOrigin } from "../_origin.js";

/* The origin allowlist is the security boundary that closes a class
   of Open Redirect vulnerabilities. Every endpoint that builds a
   Stripe success_url, Connect return_url, or Billing Portal
   return_url runs the request through safeAppOrigin so a forged
   `Origin: https://attacker.com` header collapses to the canonical
   domain instead of bouncing the user off-platform.

   These tests lock down both the allow and deny lists. */

describe("isAllowedOrigin", () => {
  it("accepts the canonical apex domain over https", () => {
    expect(isAllowedOrigin("https://cardigan.mx")).toBe(true);
    expect(isAllowedOrigin("https://cardigan.mx/")).toBe(true);
    expect(isAllowedOrigin("https://cardigan.mx/some/path")).toBe(true);
  });

  it("accepts subdomains of cardigan.mx over https", () => {
    expect(isAllowedOrigin("https://app.cardigan.mx")).toBe(true);
    expect(isAllowedOrigin("https://www.cardigan.mx")).toBe(true);
  });

  it("rejects http on production domain", () => {
    expect(isAllowedOrigin("http://cardigan.mx")).toBe(false);
    expect(isAllowedOrigin("http://app.cardigan.mx")).toBe(false);
  });

  it("accepts Vercel preview deployments over https", () => {
    expect(isAllowedOrigin("https://cardigan-abc123.vercel.app")).toBe(true);
    expect(isAllowedOrigin("https://cardigan-git-main-cardiganapps.vercel.app")).toBe(true);
  });

  it("rejects cardigan-fawn.vercel.app and similar over http", () => {
    expect(isAllowedOrigin("http://cardigan-abc.vercel.app")).toBe(false);
  });

  it("accepts localhost dev servers", () => {
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://localhost")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects attacker domains that look like cardigan.mx", () => {
    expect(isAllowedOrigin("https://cardigan.mx.attacker.com")).toBe(false);
    expect(isAllowedOrigin("https://attacker.com/cardigan.mx")).toBe(false);
    expect(isAllowedOrigin("https://evilcardigan.mx")).toBe(false);
    expect(isAllowedOrigin("https://cardigan.mx-attacker.com")).toBe(false);
  });

  it("rejects suffixed-vercel domains", () => {
    expect(isAllowedOrigin("https://attacker.vercel.app.evil.com")).toBe(false);
    expect(isAllowedOrigin("https://vercel.app")).toBe(false);
    expect(isAllowedOrigin("https://my-vercel.app")).toBe(false);
  });

  it("rejects javascript: and data: schemes", () => {
    expect(isAllowedOrigin("javascript:alert(1)")).toBe(false);
    expect(isAllowedOrigin("data:text/html,<script>")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isAllowedOrigin("not-a-url")).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
    expect(isAllowedOrigin(42)).toBe(false);
  });

  it("normalizes case in the host", () => {
    expect(isAllowedOrigin("https://Cardigan.MX")).toBe(true);
    expect(isAllowedOrigin("https://CARDIGAN.MX")).toBe(true);
  });
});

describe("safeAppOrigin", () => {
  it("returns the canonical domain when no origin/referer header is set", () => {
    const req = { headers: {} };
    expect(safeAppOrigin(req)).toBe("https://cardigan.mx");
  });

  it("returns origin when allowlisted", () => {
    const req = { headers: { origin: "https://cardigan.mx" } };
    expect(safeAppOrigin(req)).toBe("https://cardigan.mx");
  });

  it("returns origin for Vercel previews", () => {
    const req = { headers: { origin: "https://cardigan-xyz.vercel.app" } };
    expect(safeAppOrigin(req)).toBe("https://cardigan-xyz.vercel.app");
  });

  it("falls back to canonical when origin is forged", () => {
    const req = { headers: { origin: "https://attacker.com" } };
    expect(safeAppOrigin(req)).toBe("https://cardigan.mx");
  });

  it("falls back to canonical when only referer is set and forged", () => {
    const req = { headers: { referer: "https://attacker.com/path" } };
    expect(safeAppOrigin(req)).toBe("https://cardigan.mx");
  });

  it("uses referer when origin is missing and referer is allowlisted", () => {
    const req = { headers: { referer: "https://app.cardigan.mx/some/path" } };
    expect(safeAppOrigin(req)).toBe("https://app.cardigan.mx");
  });

  it("strips path/query/hash from origin", () => {
    const req = { headers: { origin: "https://cardigan.mx/extra/path?q=1#frag" } };
    expect(safeAppOrigin(req)).toBe("https://cardigan.mx");
  });

  it("does not return cardigan-fawn over http (legacy redirect domain)", () => {
    // The CLAUDE.md notes flagged cardigan-fawn as the legacy
    // domain that strips Authorization on redirect. Even though it's
    // a vercel.app, https-only is enforced.
    const req = { headers: { origin: "http://cardigan-fawn.vercel.app" } };
    expect(safeAppOrigin(req)).toBe("https://cardigan.mx");
  });

  it("ignores non-string origin/referer values defensively", () => {
    const req = { headers: { origin: 42, referer: { malformed: true } } };
    expect(safeAppOrigin(req)).toBe("https://cardigan.mx");
  });
});
