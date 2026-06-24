import { describe, it, expect } from "vitest";
import {
  buildNewPatientPayload,
  buildPotentialPayload,
  type NewPatientFormState,
} from "../newPatientPayload";

const form = (over: Partial<NewPatientFormState> = {}): NewPatientFormState => ({
  name: "Ana López",
  isMinor: false,
  parent: "",
  rate: "800",
  openingBalanceAmount: "",
  openingBalanceDir: "owes",
  tutorFrequency: "",
  phone: "55 1234 5678",
  email: "  ana@example.com ",
  whatsappEnabled: false,
  externalFolderUrl: "",
  birthdate: "2026-06-24",
  birthdateUntouched: true,
  showHealthFields: false,
  heightCm: "",
  goalWeightKg: "",
  goalBodyFatPct: "",
  goalSkeletalMuscleKg: "",
  allergies: "",
  medicalConditions: "",
  schedulingMode: "recurring",
  schedules: [{ day: "Lunes", time: "16:00", duration: "60", modality: "presencial", frequency: "weekly" }],
  startDate: "2026-06-24",
  hasEndDate: false,
  endDate: "",
  skipFirstConsult: false,
  firstConsultDate: "2026-07-01",
  firstConsultTime: "10:00",
  firstConsultDuration: "60",
  firstConsultModality: "presencial",
  ...over,
});

describe("buildNewPatientPayload — recurring", () => {
  it("normalizes contact, keeps name/parent UNTRIMMED, signs opening balance", () => {
    const p = buildNewPatientPayload(form({ name: "  Ana  ", isMinor: true, parent: "  Mamá ", openingBalanceAmount: "500", openingBalanceDir: "credit" }));
    expect(p.name).toBe("  Ana  ");           // NOT trimmed (server trims)
    expect(p.parent).toBe("  Mamá ");          // NOT trimmed
    expect(p.phone).toBe("5512345678");
    expect(p.email).toBe("ana@example.com");
    expect(p.openingBalance).toBe(-500);       // credit → negative
  });

  it("parent/tutorFrequency only when minor", () => {
    expect(buildNewPatientPayload(form({ isMinor: false, parent: "X", tutorFrequency: "4" })).parent).toBe("");
    expect(buildNewPatientPayload(form({ isMinor: false, tutorFrequency: "4" })).tutorFrequency).toBeNull();
    expect(buildNewPatientPayload(form({ isMinor: true, tutorFrequency: "4" })).tutorFrequency).toBe(4);
  });

  it("WhatsApp only enabled when a phone is present", () => {
    expect(buildNewPatientPayload(form({ whatsappEnabled: true })).whatsappEnabled).toBe(true);
    expect(buildNewPatientPayload(form({ whatsappEnabled: true, phone: "" })).whatsappEnabled).toBe(false);
  });

  it("birthdate is null while untouched, real once edited", () => {
    expect(buildNewPatientPayload(form({ birthdateUntouched: true })).birthdate).toBeNull();
    expect(buildNewPatientPayload(form({ birthdate: "2000-01-01", birthdateUntouched: false })).birthdate).toBe("2000-01-01");
  });

  it("health fields are null/empty unless showHealthFields", () => {
    const hidden = buildNewPatientPayload(form({ showHealthFields: false, heightCm: "180", allergies: "nuez" }));
    expect(hidden.heightCm).toBeNull();
    expect(hidden.allergies).toBe("");
    const shown = buildNewPatientPayload(form({ showHealthFields: true, heightCm: "180", allergies: " nuez " }));
    expect(shown.heightCm).toBe(180);
    expect(shown.allergies).toBe("nuez");
  });

  it("recurring → keeps schedules + startDate, recurring true, no firstConsult", () => {
    const p = buildNewPatientPayload(form({ hasEndDate: true, endDate: "2026-12-31" }));
    expect(p.recurring).toBe(true);
    expect(Array.isArray(p.schedules) && (p.schedules as unknown[]).length).toBe(1);
    expect(p.startDate).toBe("2026-06-24");
    expect(p.endDate).toBe("2026-12-31");
    expect(p.firstConsult).toBeNull();
  });

  it("externalFolderUrl trims to null when blank", () => {
    expect(buildNewPatientPayload(form({ externalFolderUrl: "   " })).externalFolderUrl).toBeNull();
    expect(buildNewPatientPayload(form({ externalFolderUrl: " https://x.com " })).externalFolderUrl).toBe("https://x.com");
  });
});

describe("buildNewPatientPayload — episodic", () => {
  it("clears the weekly slot + startDate/endDate, recurring false", () => {
    const p = buildNewPatientPayload(form({ schedulingMode: "episodic", hasEndDate: true, endDate: "2026-12-31" }));
    expect(p.schedules).toEqual([]);
    expect(p.recurring).toBe(false);
    expect(p.startDate).toBeNull();
    expect(p.endDate).toBeNull();
  });

  it("attaches the first consult unless skipped", () => {
    const withConsult = buildNewPatientPayload(form({ schedulingMode: "episodic", skipFirstConsult: false }));
    expect(withConsult.firstConsult).toMatchObject({ date: "2026-07-01", time: "10:00", duration: 60, modality: "presencial" });
    const skipped = buildNewPatientPayload(form({ schedulingMode: "episodic", skipFirstConsult: true }));
    expect(skipped.firstConsult).toBeNull();
  });
});

describe("buildPotentialPayload", () => {
  it("TRIMS name/parent (unlike the full payload) and always carries the interview", () => {
    const p = buildPotentialPayload(form({ name: "  Ana  ", isMinor: true, parent: "  Mamá " }));
    expect(p.name).toBe("Ana");
    expect(p.parent).toBe("Mamá");
    expect(p.phone).toBe("5512345678");
    expect(p.interview).toMatchObject({ date: "2026-07-01", time: "10:00", duration: 60, modality: "presencial" });
  });

  it("parent empty when not minor; WhatsApp gated on phone", () => {
    expect(buildPotentialPayload(form({ isMinor: false, parent: "X" })).parent).toBe("");
    expect(buildPotentialPayload(form({ whatsappEnabled: true, phone: "" })).whatsappEnabled).toBe(false);
  });
});
