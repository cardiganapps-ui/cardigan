import { describe, it, expect } from "vitest";
import { PII_FIELDS, scrubPII } from "../../lib/sentry";

/* ── Sentry PII scrub regression test ──
   Locks in the contract that every field listed in PII_FIELDS gets
   redacted by scrubPII. If a contributor adds a sensitive field to the
   schema without listing it here, this test stays silent — but the
   inverse (someone removing a field from PII_FIELDS) is loud, which
   is the half that matters for a security regression.

   Also exercises nested + array shapes since real Sentry events nest
   arbitrarily (event.extra → array of patient objects → keys). */

describe("scrubPII", () => {
  it("redacts every field listed in PII_FIELDS", () => {
    const input = {};
    for (const f of PII_FIELDS) input[f] = "sensitive-value";
    const output = scrubPII(input);
    for (const f of PII_FIELDS) {
      expect(output[f], `Field "${f}" was not redacted`).toBe("[redacted]");
    }
  });

  it("preserves non-PII fields untouched", () => {
    const input = {
      profession: "psychologist",
      count: 42,
      flag: true,
      tag: "demo",
    };
    expect(scrubPII(input)).toEqual(input);
  });

  it("redacts nested PII inside an object", () => {
    const input = {
      session: {
        date: "2026-04-27",
        patient: "Ana López",       // ← redact
        notes: "private clinical note", // ← redact
      },
    };
    const output = scrubPII(input);
    expect(output.session.date).toBe("2026-04-27");
    expect(output.session.patient).toBe("[redacted]");
    expect(output.session.notes).toBe("[redacted]");
  });

  it("redacts PII inside arrays of objects", () => {
    const input = {
      patients: [
        { id: "1", name: "x", phone: "+5215555555555" },
        { id: "2", name: "y", phone: "+5216666666666" },
      ],
    };
    const output = scrubPII(input);
    expect(output.patients[0].phone).toBe("[redacted]");
    expect(output.patients[1].phone).toBe("[redacted]");
    // Non-PII stays.
    expect(output.patients[0].id).toBe("1");
  });

  it("does not crash on null / primitive input", () => {
    expect(scrubPII(null)).toBeNull();
    expect(scrubPII("just a string")).toBe("just a string");
    expect(scrubPII(42)).toBe(42);
    expect(scrubPII(undefined)).toBeUndefined();
  });

  it("includes critical secret-class fields", () => {
    // Hard-coded set acts as a tripwire — if someone removes one of
    // these from PII_FIELDS, this test fires before the change ships.
    const mustHave = [
      "password", "access_token", "refresh_token", "secret",
      "totp_secret", "code", "token", "calendar_token",
      "patient", "notes", "email", "phone", "file_path",
    ];
    for (const f of mustHave) {
      expect(PII_FIELDS.has(f), `${f} missing from PII_FIELDS`).toBe(true);
    }
  });
});
