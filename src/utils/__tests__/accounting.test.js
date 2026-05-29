import { describe, it, expect } from "vitest";
import {
  sessionCountsTowardBalance,
  computeConsumedByPatient,
  enrichPatientsWithBalance,
} from "../accounting";

// Fixed reference time so tests are deterministic across years.
// Today (in these tests) = 2026-04-24 10:00.
const NOW = new Date(2026, 3, 24, 10, 0);

// Builders
const sess = (patient_id, status, rate = 700, overrides = {}) => ({
  patient_id, status, rate,
  date: overrides.date ?? "1-Ene",
  time: overrides.time ?? "10:00",
  ...overrides,
});
const pat = (id, rate = 700, paid = 0, extra = {}) => ({
  id, rate, paid, ...extra,
});

describe("sessionCountsTowardBalance", () => {
  it("counts explicit completed", () => {
    expect(sessionCountsTowardBalance(
      sess("p", "completed", 700, { date: "1-Ene" }), NOW
    )).toBe(true);
  });

  it("counts charged even on a future date (cancel-with-charge owes immediately)", () => {
    expect(sessionCountsTowardBalance(
      sess("p", "charged", 700, { date: "31-Dic", time: "10:00" }), NOW
    )).toBe(true);
  });

  it("counts scheduled whose date+time has passed (auto-complete equivalent)", () => {
    // 23-Abr is yesterday — past.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "23-Abr", time: "10:00" }), NOW
    )).toBe(true);
  });

  it("does NOT count scheduled whose date is in the future", () => {
    // 28-Abr is a few days away — future.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "28-Abr", time: "10:00" }), NOW
    )).toBe(false);
  });

  it("does NOT count a scheduled session that started less than an hour ago", () => {
    // Session was today 09:30; now is 10:00, so it's only 30m in. +1h grace
    // means it doesn't flip to consumed yet — matches the display auto-
    // complete rule so the UI and the balance agree.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "24-Abr", time: "09:30" }), NOW
    )).toBe(false);
  });

  it("counts a scheduled session whose 1-hour grace has elapsed", () => {
    // Session at 09:00 today; now is 10:00 — past end-of-grace.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "24-Abr", time: "09:00" }), NOW
    )).toBe(true);
  });

  it("does NOT count cancelled", () => {
    expect(sessionCountsTowardBalance(
      sess("p", "cancelled", 700, { date: "1-Ene" }), NOW
    )).toBe(false);
  });

  it("handles null/undefined session input", () => {
    expect(sessionCountsTowardBalance(null, NOW)).toBe(false);
    expect(sessionCountsTowardBalance(undefined, NOW)).toBe(false);
  });

  it("handles a session whose 1-hour grace crosses midnight", () => {
    // Session at 23:45 on 23-Abr → end-moment is 00:45 on 24-Abr.
    // NOW is 24-Abr at 10:00, well past the rollover.
    // setHours+setMinutes mutates the Date in place; combined with the
    // +1h add, the wall-clock is 24-Abr 00:45 not 23-Abr 24:45 — JS
    // Date math handles the day rollover, so the predicate should
    // return true.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "23-Abr", time: "23:45" }), NOW
    )).toBe(true);
  });

  it("handles a session right at the year boundary (Dec 31 23:30)", () => {
    // 31-Dic inferred to 2025 (closest to NOW=2026-04-24 is 2025-12-31,
    // ~115 days back; 2026-12-31 is ~250 days ahead). +1h end = 2026-01-01
    // 00:30 — past relative to NOW.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "31-Dic", time: "23:30" }), NOW
    )).toBe(true);
  });
});

describe("computeConsumedByPatient", () => {
  it("sums completed + charged + past-scheduled", () => {
    const rateById = new Map([["p1", 700]]);
    const m = computeConsumedByPatient([
      sess("p1", "completed", 700, { date: "1-Ene" }),
      sess("p1", "charged",   500, { date: "1-Ene" }),
      sess("p1", "scheduled", 700, { date: "23-Abr", time: "10:00" }),  // past → counts
      sess("p1", "scheduled", 700, { date: "28-Abr", time: "10:00" }),  // future → skipped
      sess("p1", "cancelled", 700, { date: "1-Ene" }),                  // never counts
    ], rateById, NOW);
    expect(m.get("p1")).toBe(700 + 500 + 700);  // 1900
  });

  it("falls back to patient.rate when session.rate is null", () => {
    // Imported historical rows often have rate=null. We apply the current
    // patient rate as fallback so consumed reflects reality.
    const rateById = new Map([["p1", 800]]);
    const m = computeConsumedByPatient([
      sess("p1", "scheduled", null, { date: "1-Ene" }),
    ], rateById, NOW);
    expect(m.get("p1")).toBe(800);
  });

  it("skips sessions with no patient_id", () => {
    const m = computeConsumedByPatient([
      { patient_id: null, status: "completed", rate: 700, date: "1-Ene", time: "10:00" },
    ], new Map(), NOW);
    expect(m.size).toBe(0);
  });

  it("handles empty / nullish input without throwing", () => {
    expect(computeConsumedByPatient(null, new Map(), NOW).size).toBe(0);
    expect(computeConsumedByPatient([], new Map(), NOW).size).toBe(0);
  });

  it("keeps different patients isolated", () => {
    const rateById = new Map([["p1", 700], ["p2", 500]]);
    const m = computeConsumedByPatient([
      sess("p1", "completed", 700, { date: "1-Ene" }),
      sess("p2", "charged",   500, { date: "1-Ene" }),
    ], rateById, NOW);
    expect(m.get("p1")).toBe(700);
    expect(m.get("p2")).toBe(500);
  });
});

describe("enrichPatientsWithBalance", () => {
  it("amountDue = consumed − paid when consumed > paid", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 300)],
      [sess("p1", "completed", 700, { date: "1-Ene" })],
      NOW,
    );
    expect(out.amountDue).toBe(400);
    expect(out.credit).toBe(0);
  });

  it("credit = paid − consumed when paid > consumed (prepaid)", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 2000)],
      [sess("p1", "completed", 700, { date: "1-Ene" })],
      NOW,
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(1300);
  });

  it("amountDue and credit are mutually exclusive", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 700)],
      [sess("p1", "completed", 700, { date: "1-Ene" })],
      NOW,
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(0);
  });

  it("includes past-scheduled sessions (the critical product requirement)", () => {
    // Therapists almost never mark sessions completed — they rely on the
    // past-scheduled-counts rule. If that branch regresses, every active
    // patient goes to credit and therapists appear to owe the user money.
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [
        sess("p1", "scheduled", 700, { date: "10-Abr", time: "10:00" }),
        sess("p1", "scheduled", 700, { date: "17-Abr", time: "10:00" }),
        sess("p1", "scheduled", 700, { date: "23-Abr", time: "10:00" }),  // yesterday
      ],
      NOW,
    );
    expect(out.amountDue).toBe(2100);
  });

  it("future-scheduled sessions are excluded", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [
        sess("p1", "scheduled", 700, { date: "28-Abr", time: "10:00" }),
        sess("p1", "scheduled", 700, { date: "5-May", time: "10:00" }),
      ],
      NOW,
    );
    expect(out.amountDue).toBe(0);
  });

  it("cancel-with-charge (CHARGED) contributes immediately, no date filter", () => {
    // A CHARGED session owes the therapist from the moment the cancel
    // fee is booked — even if the original session date is in the future.
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [sess("p1", "charged", 700, { date: "31-Dic", time: "10:00" })],
      NOW,
    );
    expect(out.amountDue).toBe(700);
  });

  it("cancelled (without charge) never inflates", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [
        sess("p1", "cancelled", 700, { date: "10-Abr" }),
        sess("p1", "cancelled", 700, { date: "17-Abr" }),
      ],
      NOW,
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(0);
  });

  it("preserves historical rate accuracy when patient.rate changes", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 900, 0)],  // rate was raised to 900
      [
        sess("p1", "completed", 700, { date: "1-Ene" }),  // old session at old rate
        sess("p1", "completed", 900, { date: "1-Feb" }),  // new session at new rate
      ],
      NOW,
    );
    expect(out.amountDue).toBe(1600);
  });

  it("returns empty array for null/undefined patients input", () => {
    expect(enrichPatientsWithBalance(null, [], NOW)).toEqual([]);
    expect(enrichPatientsWithBalance(undefined, [], NOW)).toEqual([]);
  });

  it("preserves all other patient fields", () => {
    const [out] = enrichPatientsWithBalance(
      [{ id: "p1", rate: 700, paid: 0, name: "Ana", status: "active" }],
      [],
      NOW,
    );
    expect(out.name).toBe("Ana");
    expect(out.status).toBe("active");
  });
});

/* ── Interview-stage / potential patients (migration 047) ──
   Critical safety: an interview session on a 'potential' patient must
   pass through sessionCountsTowardBalance the same way a regular
   session does — no special-case branch in the predicate. The
   difference between a potential's interview balance and a real
   patient's session balance is enforced ONE LEVEL UP, in the KPI
   filters that exclude isPotentialOrDiscarded(p) from Home / Finances
   / Cardi totals. These tests pin the predicate's behavior so a
   future change can't accidentally couple the two layers. */
describe("interview sessions (potential patients)", () => {
  it("free interview (rate=0, completed) → consumed=0, amountDue=0, credit=0", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 0, 0, { status: "potential" })],
      [sess("p1", "completed", 0, { date: "10-Abr", session_type: "interview" })],
      NOW,
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(0);
  });

  it("scheduled future interview does NOT pre-fire auto-complete", () => {
    // 1-May is in the future from NOW (24-Abr).
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 500, 0, { status: "potential" })],
      [sess("p1", "scheduled", 500, { date: "1-May", time: "10:00", session_type: "interview" })],
      NOW,
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(0);
  });

  it("completed paid interview at $500 contributes to consumed like any session", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 500, 0, { status: "potential" })],
      [sess("p1", "completed", 500, { date: "10-Abr", session_type: "interview" })],
      NOW,
    );
    expect(out.amountDue).toBe(500);
  });

  it("interview at $0 doesn't poison rate fallback for active patient's other sessions", () => {
    // patient.rate = 700; one historical interview at $0 + one
    // recurring session at $700. Rate fallback must use session.rate
    // first so the interview's $0 doesn't override the regular rate.
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0, { status: "active" })],
      [
        sess("p1", "completed", 0,   { date: "5-Abr",  session_type: "interview" }),
        sess("p1", "completed", 700, { date: "12-Abr", session_type: "regular" }),
      ],
      NOW,
    );
    // consumed = 0 (interview) + 700 (regular) = 700
    expect(out.amountDue).toBe(700);
  });
});

/* ── Timezone-aware predicate (prime-directive #4) ──
   The SQL function `public.session_counts_at` evaluates the +1h
   auto-complete window in the user's `notification_preferences.tz`.
   The JS predicate used to evaluate it in browser-local TZ, which
   meant a therapist whose laptop was in (e.g.) Europe/London while
   their saved tz was America/Mexico_City would see the UI-derived
   `amountDue` diverge from the trigger-maintained `patient.billed`
   by exactly one rate near the boundary.

   These tests pin the JS twin's TZ-aware behavior to the same rules
   the SQL function follows, so a future drift in either direction
   fails CI before reaching production. */
describe("sessionCountsTowardBalance with explicit tz", () => {
  // Pinned instant: 2026-04-24 16:00 UTC = 10:00 in America/Mexico_City
  // (which is UTC-6 year-round; Mexico abolished DST in 2022).
  const REF = new Date("2026-04-24T16:00:00Z");

  it("a session ending exactly at REF in the saved tz flips to counted", () => {
    // 24-Abr 09:00 MX + 1h = 24-Abr 10:00 MX = 16:00 UTC = REF. now >= end.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "24-Abr", time: "09:00" }),
      REF, "America/Mexico_City",
    )).toBe(true);
  });

  it("a session ending one minute after REF in the saved tz is NOT counted", () => {
    // 24-Abr 09:01 MX + 1h = 24-Abr 10:01 MX = 16:01 UTC. now < end.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "24-Abr", time: "09:01" }),
      REF, "America/Mexico_City",
    )).toBe(false);
  });

  it("same predicate, same instant, different tz → different answer at the boundary", () => {
    // Session at "24-Abr 09:30". REF = 16:00 UTC.
    //  • In America/Mexico_City: session-end = 10:30 MX = 16:30 UTC.
    //    16:00 < 16:30 → NOT counted.
    //  • In UTC: session-end = 24-Abr 10:30 UTC. 16:00 > 10:30 → counted.
    // This is the exact failure mode the prime-directive guards against.
    const s = sess("p", "scheduled", 700, { date: "24-Abr", time: "09:30" });
    expect(sessionCountsTowardBalance(s, REF, "America/Mexico_City")).toBe(false);
    expect(sessionCountsTowardBalance(s, REF, "UTC")).toBe(true);
  });

  it("auto-complete window crosses midnight cleanly in the saved tz", () => {
    // 23-Abr 23:45 MX + 1h = 24-Abr 00:45 MX = 06:45 UTC. REF = 16:00 UTC.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "23-Abr", time: "23:45" }),
      REF, "America/Mexico_City",
    )).toBe(true);
  });

  it("year-boundary inference (Dec/Jan) uses the saved tz", () => {
    // REF = 24-Abr-26 in MX. Closest year for "31-Dic" is 2025.
    // 31-Dic 23:00 MX 2025 + 1h = 1-Ene 00:00 MX 2026 = 06:00 UTC 1-Ene-26.
    // Well before REF — counted.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "31-Dic", time: "23:00" }),
      REF, "America/Mexico_City",
    )).toBe(true);
  });

  it("explicit year in date string ('1-Ene-27') is honored under tz", () => {
    // 1-Ene-27 = 2027, well after REF (2026-04). NOT counted.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "1-Ene-27", time: "10:00" }),
      REF, "America/Mexico_City",
    )).toBe(false);
  });
});
