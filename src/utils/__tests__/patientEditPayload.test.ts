import { describe, it, expect } from "vitest";
import { buildPatientEditPayload, type PatientEditForm } from "../patientEditPayload";

const NOW = "2026-06-24T12:00:00.000Z";

const form = (over: Partial<PatientEditForm> = {}): PatientEditForm => ({
  name: "  Ana López  ",
  isMinor: false,
  parent: "",
  tutorFrequency: "",
  phone: "55 1234 5678",
  email: "  ana@example.com ",
  birthdate: "",
  startDate: "",
  status: "active",
  rate: "800",
  openingBalance: 0,
  whatsappEnabled: false,
  whatsappConsentAt: null,
  ...over,
});

describe("buildPatientEditPayload", () => {
  it("trims name/email, normalizes phone to digits, maps empty dates to null", () => {
    const p = buildPatientEditPayload(form({ birthdate: "", startDate: "2026-01-01" }), NOW);
    expect(p.name).toBe("Ana López");
    expect(p.email).toBe("ana@example.com");
    expect(p.phone).toBe("5512345678");
    expect(p.birthdate).toBeNull();
    expect(p.start_date).toBe("2026-01-01");
  });

  it("includes parent + tutor_frequency only for minors", () => {
    const adult = buildPatientEditPayload(form({ isMinor: false, parent: "Mamá", tutorFrequency: "2" }), NOW);
    expect(adult.parent).toBe("");
    expect(adult.tutor_frequency).toBeNull();
    const minor = buildPatientEditPayload(form({ isMinor: true, parent: "  Mamá ", tutorFrequency: "2" }), NOW);
    expect(minor.parent).toBe("Mamá");
    expect(minor.tutor_frequency).toBe(2);
  });

  it("passes the (already-signed) opening balance straight through", () => {
    expect(buildPatientEditPayload(form({ openingBalance: -500 }), NOW).opening_balance).toBe(-500);
  });

  it("WhatsApp: enabled WITH a phone → true + stamps consent when missing", () => {
    const p = buildPatientEditPayload(form({ whatsappEnabled: true, whatsappConsentAt: null }), NOW);
    expect(p.whatsapp_enabled).toBe(true);
    expect(p.whatsapp_consent_at).toBe(NOW);
  });

  it("WhatsApp: preserves an existing consent timestamp", () => {
    const prior = "2026-01-01T00:00:00.000Z";
    const p = buildPatientEditPayload(form({ whatsappEnabled: true, whatsappConsentAt: prior }), NOW);
    expect(p.whatsapp_consent_at).toBe(prior);
  });

  it("WhatsApp: enabled but NO phone → false + null consent", () => {
    const p = buildPatientEditPayload(form({ whatsappEnabled: true, phone: "" }), NOW);
    expect(p.whatsapp_enabled).toBe(false);
    expect(p.whatsapp_consent_at).toBeNull();
  });

  it("WhatsApp: disabled → false + clears consent", () => {
    const p = buildPatientEditPayload(form({ whatsappEnabled: false, whatsappConsentAt: "2026-01-01T00:00:00.000Z" }), NOW);
    expect(p.whatsapp_enabled).toBe(false);
    expect(p.whatsapp_consent_at).toBeNull();
  });

  it("status/rate are omitted by default and included per opts", () => {
    const base = buildPatientEditPayload(form(), NOW);
    expect("status" in base).toBe(false);
    expect("rate" in base).toBe(false);

    const withStatus = buildPatientEditPayload(form({ status: "ended" }), NOW, { includeStatus: true });
    expect(withStatus.status).toBe("ended");
    expect("rate" in withStatus).toBe(false);

    const withBoth = buildPatientEditPayload(form({ rate: "950" }), NOW, { includeStatus: true, includeRate: true });
    expect(withBoth.status).toBe("active");
    expect(withBoth.rate).toBe(950);
  });

  it("rate falls back to 0 when blank/non-numeric", () => {
    expect(buildPatientEditPayload(form({ rate: "" }), NOW, { includeRate: true }).rate).toBe(0);
    expect(buildPatientEditPayload(form({ rate: "abc" }), NOW, { includeRate: true }).rate).toBe(0);
  });
});
