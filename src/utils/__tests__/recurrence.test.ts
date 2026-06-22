import { describe, it, expect } from "vitest";
import { computeAutoExtendRows, getRecurringDates } from "../recurrence";
import { formatShortDate, toISODate } from "../dates";
import { PATIENT_STATUS, SESSION_STATUS, RECURRENCE_EXTEND_THRESHOLD_DAYS, RECURRENCE_WINDOW_WEEKS } from "../../data/constants";

// Tests below lock in two real accounting bugs that previously
// inflated amountDue in production:
//   1. Auto-extend back-filling past dates → phantom completed
//      sessions → consumed > reality → amountDue too high.
//   2. Auto-extend pulling old day/time slots from history (after a
//      schedule change) → duplicate weekly sessions on abandoned
//      slots → both consumed and the visible calendar wrong.
// If you're touching utils/recurrence.js and any of these turn red,
// STOP and verify the accounting impact before changing the test.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const DAY_MS = 86400000;

function buildContext(today: Row) {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const threshold = new Date(t);
  threshold.setDate(t.getDate() + RECURRENCE_EXTEND_THRESHOLD_DAYS);
  const extendEnd = toISODate(new Date(t.getTime() + RECURRENCE_WINDOW_WEEKS * 7 * DAY_MS));
  return { today: t, threshold, extendEnd, userId: "user-1" };
}

function activePatient(overrides = {}) {
  return {
    id: "p1", name: "Ana", initials: "AN",
    status: PATIENT_STATUS.ACTIVE,
    rate: 700, sessions: 0, billed: 0, paid: 0,
    color_idx: 0,
    ...overrides,
  };
}

function scheduledMon10(daysFromToday: Row, today: Row) {
  const d = new Date(today.getTime() + daysFromToday * DAY_MS);
  return {
    id: `s-${daysFromToday}`,
    patient_id: "p1",
    status: SESSION_STATUS.SCHEDULED,
    initials: "AN",
    day: "Lunes", time: "10:00",
    duration: 60, rate: 700,
    modality: "presencial",
    date: formatShortDate(d),
  };
}

describe("computeAutoExtendRows — accounting safety", () => {
  it("returns no rows for an inactive patient", () => {
    const ctx = buildContext(new Date());
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient({ status: PATIENT_STATUS.ENDED }),
      allPSess: [scheduledMon10(7, ctx.today)],
    });
    expect(rows).toEqual([]);
  });

  it("returns no rows for an episodic patient — even with an is_recurring future row", () => {
    // Defense-in-depth: a stray is_recurring=true row on an episodic
    // patient (manual DB edit, post-mode-flip leftover) must NOT
    // trigger the weekly extender. The user opted out of perpetual
    // recurrence by flipping mode; honor that.
    const ctx = buildContext(new Date());
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient({ scheduling_mode: "episodic" }),
      allPSess: [
        { ...scheduledMon10(7, ctx.today), is_recurring: true },
      ],
    });
    expect(rows).toEqual([]);
  });

  it("returns no rows when patient has no sessions", () => {
    const ctx = buildContext(new Date());
    expect(computeAutoExtendRows({
      ...ctx, patient: activePatient(), allPSess: [],
    })).toEqual([]);
  });

  it("returns no rows when only completed/cancelled sessions exist (no current schedule)", () => {
    const ctx = buildContext(new Date());
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess: [
        { ...scheduledMon10(-30, ctx.today), status: SESSION_STATUS.COMPLETED },
        { ...scheduledMon10(-23, ctx.today), status: SESSION_STATUS.COMPLETED },
        { ...scheduledMon10(-16, ctx.today), status: SESSION_STATUS.CANCELLED },
      ],
    });
    expect(rows).toEqual([]);
  });

  it("returns no rows when latest scheduled is past the extend threshold", () => {
    const ctx = buildContext(new Date());
    // Latest scheduled is RECURRENCE_EXTEND_THRESHOLD_DAYS + 30 days out — well in the future.
    const days = RECURRENCE_EXTEND_THRESHOLD_DAYS + 30;
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess: [scheduledMon10(days, ctx.today)],
    });
    expect(rows).toEqual([]);
  });

  it("BUG REGRESSION: never generates sessions in the past when latest is behind today", () => {
    // Patient took a hiatus — latest scheduled session is 60 days ago.
    // The OLD code would back-fill weekly Monday sessions from that
    // point forward, including 8+ Mondays in the past. Those would
    // auto-complete in display and inflate amountDue by 8 × rate.
    //
    // Today the date filter on `scheduledRegular` makes this scenario
    // return [] regardless (past rows don't seed the schedMap), but
    // we keep the test alongside a future-anchored fixture to lock
    // the past-date safety check in place independently.
    const ctx = buildContext(new Date("2026-04-20T12:00:00"));
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      // Two future sessions on Lunes 10:00 (active recurring slot)
      // plus one historical row 60 days ago. The historical row must
      // not pull the start window into the past.
      allPSess: [
        scheduledMon10(7, ctx.today),
        scheduledMon10(14, ctx.today),
        scheduledMon10(-60, ctx.today),
      ],
    });
    const todayISO = toISODate(ctx.today);
    for (const r of rows) {
      // We assert via formatted `date` field (D-MMM, no year) by
      // re-constructing an ISO from the row's order — but the easier
      // and stronger assertion is: every generated row's intended
      // date must be >= today. We check by parsing with the same
      // helper used elsewhere.
      const iso = isoFromShortDate(r.date, ctx.today);
      expect(iso >= todayISO).toBe(true);
    }
  });

  it("BUG REGRESSION: phantom past 'scheduled' rows from an abandoned slot don't drive future generation", () => {
    // Production bug reported by a nutritionist user: she moved a
    // patient from Lunes to Miércoles weeks ago; phantom Lunes
    // sessions kept appearing in the future (and silently inflating
    // amountDue once they aged past today).
    //
    // The realistic state is: past Lunes rows still have
    // status='scheduled' because auto-complete is display-only —
    // CLAUDE.md is explicit. Without a date filter on the
    // schedule-derivation set, those abandoned past rows feed the
    // schedMap and the auto-extend regenerates phantom Lunes
    // sessions on top of the current Miércoles ones.
    //
    // Mirror the realistic state here: past abandoned slots use
    // status=SCHEDULED, not COMPLETED. (The earlier version of this
    // test used COMPLETED, so the bug shipped despite green tests.)
    const ctx = buildContext(new Date("2026-04-20T12:00:00"));
    const oldSchedule = [-30, -23, -16, -9].map(d => scheduledMon10(d, ctx.today));
    const newSchedule = [7, 14, 21].map(d => {
      const dt = new Date(ctx.today.getTime() + d * DAY_MS);
      return {
        id: `w-${d}`,
        patient_id: "p1",
        status: SESSION_STATUS.SCHEDULED,
        initials: "AN",
        day: "Miércoles", time: "15:00",
        duration: 60, rate: 700,
        modality: "presencial",
        date: formatShortDate(dt),
      };
    });
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess: [...oldSchedule, ...newSchedule],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.day).toBe("Miércoles");
      expect(r.time).toBe("15:00");
    }
  });

  it("BUG REGRESSION: schedule change is honoured even when past rows match the OLD slot only", () => {
    // Same Lunes→Miércoles change but the original test variant —
    // past sessions explicitly marked COMPLETED. This catches the
    // earlier symptom where status=COMPLETED rows leaked too.
    const ctx = buildContext(new Date("2026-04-20T12:00:00"));
    const oldSchedule = [-30, -23, -16, -9].map(d => ({
      ...scheduledMon10(d, ctx.today),
      status: SESSION_STATUS.COMPLETED,
    }));
    const newSchedule = [7, 14, 21].map(d => {
      const dt = new Date(ctx.today.getTime() + d * DAY_MS);
      return {
        id: `w-${d}`,
        patient_id: "p1",
        status: SESSION_STATUS.SCHEDULED,
        initials: "AN",
        day: "Miércoles", time: "15:00",
        duration: 60, rate: 700,
        modality: "presencial",
        date: formatShortDate(dt),
      };
    });
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess: [...oldSchedule, ...newSchedule],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.day).toBe("Miércoles");
      expect(r.time).toBe("15:00");
    }
  });

  it("BUG REGRESSION: tutor sessions don't pollute the recurring schedule", () => {
    // One-off Sábado tutor session shouldn't make the auto-extend
    // think the patient meets every Saturday.
    const ctx = buildContext(new Date("2026-04-20T12:00:00"));
    const regularMon = [7, 14, 21].map(d => scheduledMon10(d, ctx.today));
    const sat = new Date(ctx.today.getTime() + 12 * DAY_MS);
    const tutorSat = {
      id: "t-1",
      patient_id: "p1",
      status: SESSION_STATUS.SCHEDULED,
      session_type: "tutor",
      initials: "MR",
      day: "Sábado", time: "11:00",
      duration: 60, rate: 700,
      modality: "presencial",
      date: formatShortDate(sat),
    };
    const rows = computeAutoExtendRows({
      ...ctx, patient: activePatient(),
      allPSess: [...regularMon, tutorSat],
    });
    for (const r of rows) {
      expect(r.day).toBe("Lunes");
      expect(r.time).toBe("10:00");
    }
  });

  it("BUG REGRESSION: manual one-offs (is_recurring=false) NEVER seed extension, even at scale", () => {
    // Per user direction: sessions added manually are always
    // one-offs and must never be picked up by auto-extend, even if
    // multiple of them happen to land on the same (day, time) slot.
    // The is_recurring flag is the explicit signal — manual sessions
    // get is_recurring=false in createSession, while seed inserts
    // and applyScheduleChange use is_recurring=true.
    const ctx = buildContext(new Date("2026-04-20T12:00:00"));
    const recurringMons = [7, 14, 21, 28].map(d => ({
      ...scheduledMon10(d, ctx.today),
      is_recurring: true,
    }));
    // Three manually-added Saturday sessions — count alone (3) would
    // ordinarily satisfy the ≥2-future-sessions filter, but
    // is_recurring=false vetoes them outright.
    const manualSats = [4, 11, 18].map((d, i) => {
      const dt = new Date(ctx.today.getTime() + d * DAY_MS);
      return {
        id: `man-${i}`,
        patient_id: "p1",
        status: SESSION_STATUS.SCHEDULED,
        session_type: "regular",
        is_recurring: false, // manual one-off
        initials: "AN",
        day: "Sábado", time: "09:00",
        duration: 60, rate: 700,
        modality: "presencial",
        date: formatShortDate(dt),
      };
    });
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess: [...recurringMons, ...manualSats],
    });
    for (const r of rows) {
      expect(r.day).toBe("Lunes");
      expect(r.time).toBe("10:00");
    }
  });

  it("BUG REGRESSION: a single one-off non-tutor session doesn't seed weekly extension", () => {
    // Production bug: user creates a one-off appointment with a
    // patient on a slot outside their normal schedule (e.g. a
    // Saturday session with the parent) and forgets to toggle the
    // "tutor" type picker — so the row is saved as
    // session_type='regular'. With the schedMap derived purely from
    // scheduled rows, that single one-off seeded a weekly extension
    // and minted phantom Saturdays for the next 15 weeks.
    //
    // Real recurring slots always have many future sessions (the
    // creation flow + applyScheduleChange both insert a 15-week
    // window in one batch). A one-off sits alone. Requiring ≥2
    // future sessions on a slot is enough to filter out the
    // one-off-mistake case without disturbing legitimate recurrence.
    const ctx = buildContext(new Date("2026-04-20T12:00:00"));
    const recurringMons = [7, 14, 21, 28].map(d => scheduledMon10(d, ctx.today));
    const oneOffSat = (() => {
      const dt = new Date(ctx.today.getTime() + 11 * DAY_MS); // a Saturday in the same window
      return {
        id: "one-off-sat",
        patient_id: "p1",
        status: SESSION_STATUS.SCHEDULED,
        session_type: "regular", // user FORGOT to toggle to "tutor"
        initials: "AN",
        day: "Sábado", time: "09:00",
        duration: 60, rate: 700,
        modality: "presencial",
        date: formatShortDate(dt),
      };
    })();
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess: [...recurringMons, oneOffSat],
    });
    // Only legitimate Lunes 10:00 slots should be extended; no Sábado.
    for (const r of rows) {
      expect(r.day).toBe("Lunes");
      expect(r.time).toBe("10:00");
    }
  });

  it("multi-schedule patient: both active slots extend correctly", () => {
    // Verify the ≥2-future-sessions filter doesn't break legitimate
    // multi-schedule cases. A patient with two recurring weekly slots
    // (e.g. Lunes 10:00 + Jueves 16:00) should see BOTH extended.
    const ctx = buildContext(new Date("2026-04-20T12:00:00"));
    const lunes = [7, 14, 21, 28].map(d => scheduledMon10(d, ctx.today));
    const jueves = [10, 17, 24, 31].map((d, i) => {
      const dt = new Date(ctx.today.getTime() + d * DAY_MS);
      return {
        id: `j-${i}`,
        patient_id: "p1",
        status: SESSION_STATUS.SCHEDULED,
        session_type: "regular",
        initials: "AN",
        day: "Jueves", time: "16:00",
        duration: 60, rate: 700,
        modality: "presencial",
        date: formatShortDate(dt),
      };
    });
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess: [...lunes, ...jueves],
    });
    const days = new Set(rows.map(r => `${r.day}|${r.time}`));
    expect(days.has("Lunes|10:00")).toBe(true);
    expect(days.has("Jueves|16:00")).toBe(true);
  });

  it("does not re-emit dates that already exist (including cancelled)", () => {
    const ctx = buildContext(new Date("2026-04-20T12:00:00"));
    // Three future Mondays scheduled. We also have one of the dates
    // already CANCELLED (vacation week). Auto-extend mustn't recreate
    // the cancelled one.
    const seven = scheduledMon10(7, ctx.today);
    const fourteen = { ...scheduledMon10(14, ctx.today), status: SESSION_STATUS.CANCELLED };
    const twentyOne = scheduledMon10(21, ctx.today);
    const rows = computeAutoExtendRows({
      ...ctx, patient: activePatient(),
      allPSess: [seven, fourteen, twentyOne],
    });
    const dates = new Set(rows.map(r => r.date));
    expect(dates.has(fourteen.date)).toBe(false);
    expect(dates.has(seven.date)).toBe(false);
    expect(dates.has(twentyOne.date)).toBe(false);
  });

  it("emits rows stamped with the correct user_id, patient fields, and rate", () => {
    const ctx = buildContext(new Date("2026-04-20T12:00:00"));
    // ≥2 future sessions on the slot — this is what an active
    // recurring schedule looks like in production. A single future
    // session is the one-off-mistake signature and intentionally
    // doesn't seed an extension; see the dedicated regression test.
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient({ rate: 850, color_idx: 3 }),
      allPSess: [
        scheduledMon10(7, ctx.today),
        scheduledMon10(14, ctx.today),
      ],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.user_id).toBe("user-1");
      expect(r.patient_id).toBe("p1");
      expect(r.patient).toBe("Ana");
      expect(r.initials).toBe("AN");
      expect(r.rate).toBe(850);
      expect(r.color_idx).toBe(3);
      expect(r.modality).toBe("presencial");
    }
  });
});

describe("getRecurringDates", () => {
  it("returns empty for unknown day name", () => {
    expect(getRecurringDates("Xunday", "2026-04-20")).toEqual([]);
  });

  it("includes dates from start (inclusive) to end (inclusive) on the target weekday", () => {
    // 2026-04-20 is a Monday. Asking for Mondays through 2026-05-04 yields 3.
    const dates = getRecurringDates("Lunes", "2026-04-20", "2026-05-04");
    expect(dates).toHaveLength(3);
    expect(dates[0].getDay()).toBe(1);
  });

  it("biweekly stride: every 14 days, day-of-week preserved", () => {
    // Apr 20 → Jun 1: 7 weekly Mondays (20, 27 / 4, 11, 18, 25 / 1),
    // 4 biweekly (20 / 4 / 18 / 1).
    const weekly = getRecurringDates("Lunes", "2026-04-20", "2026-06-01", "weekly");
    const biweekly = getRecurringDates("Lunes", "2026-04-20", "2026-06-01", "biweekly");
    expect(weekly).toHaveLength(7);
    expect(biweekly).toHaveLength(4);
    expect(biweekly.every(d => d.getDay() === 1)).toBe(true);
    // Verify the gap is 14 days.
    expect((+biweekly[1] - +biweekly[0]) / DAY_MS).toBe(14);
    expect((+biweekly[2] - +biweekly[1]) / DAY_MS).toBe(14);
  });

  it("monthly stride: every 28 days, day-of-week preserved", () => {
    // Apr 20 → Aug 17 (~17 weeks): 4 monthly Mondays at stride 28.
    const monthly = getRecurringDates("Lunes", "2026-04-20", "2026-08-17", "monthly");
    expect(monthly).toHaveLength(5);
    expect(monthly.every(d => d.getDay() === 1)).toBe(true);
    expect((+monthly[1] - +monthly[0]) / DAY_MS).toBe(28);
    expect((+monthly[4] - +monthly[0]) / DAY_MS).toBe(28 * 4);
  });

  it("unknown frequency falls back to weekly", () => {
    const fallback = getRecurringDates("Lunes", "2026-04-20", "2026-05-04", "annually");
    const weekly = getRecurringDates("Lunes", "2026-04-20", "2026-05-04");
    expect(fallback).toHaveLength(weekly.length);
    expect(fallback.map(d => d.getTime())).toEqual(weekly.map(d => d.getTime()));
  });
});

describe("computeAutoExtendRows — recurrence frequency", () => {
  it("reads frequency from existing future sessions and projects forward at the same stride", () => {
    const ctx = buildContext("2026-04-20T08:00:00");
    // Two biweekly Mondays in flight: today and +14d. Both have
    // recurrence_frequency='biweekly'. Latest is today + 14 days,
    // well within threshold so auto-extend fires.
    const allPSess = [
      { ...scheduledMon10(0,  ctx.today), recurrence_frequency: "biweekly" },
      { ...scheduledMon10(14, ctx.today), recurrence_frequency: "biweekly" },
    ];
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess,
    });
    // Every inserted row carries biweekly + the date stride is 14d.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.recurrence_frequency === "biweekly")).toBe(true);
    // First inserted row must be ≥ 14 days after the latest existing
    // session (today+14d). Subsequent rows differ by 14 days.
    const inserted = rows.map(r => isoFromShortDate(r.date, ctx.today));
    expect(inserted[0] >= toISODate(new Date(ctx.today.getTime() + 28 * DAY_MS))).toBe(true);
  });

  it("legacy rows missing recurrence_frequency read as weekly", () => {
    const ctx = buildContext("2026-04-20T08:00:00");
    // No recurrence_frequency on the rows — represents pre-migration data.
    const allPSess = [
      scheduledMon10(0,  ctx.today),
      scheduledMon10(7,  ctx.today),
    ];
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess,
    });
    expect(rows.length).toBeGreaterThan(0);
    // All inserted rows are stamped weekly (the safe default) so the
    // next auto-extend round agrees with the previous one.
    expect(rows.every(r => r.recurrence_frequency === "weekly")).toBe(true);
  });

  it("two slots with different frequencies extend independently", () => {
    const ctx = buildContext("2026-04-20T08:00:00");
    // Lunes 10:00 weekly + Miércoles 14:00 monthly.
    const monRows = [0, 7].map(d => ({
      ...scheduledMon10(d, ctx.today),
      recurrence_frequency: "weekly",
    }));
    const wedRows = [2, 30].map(d => {
      const dt = new Date(ctx.today.getTime() + d * DAY_MS);
      return {
        id: `w-${d}`, patient_id: "p1",
        status: SESSION_STATUS.SCHEDULED,
        initials: "AN", day: "Miércoles", time: "14:00",
        duration: 60, rate: 700, modality: "presencial",
        date: formatShortDate(dt),
        recurrence_frequency: "monthly",
      };
    });
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess: [...monRows, ...wedRows],
    });
    // Both slots extended.
    const monNew = rows.filter(r => r.day === "Lunes");
    const wedNew = rows.filter(r => r.day === "Miércoles");
    expect(monNew.length).toBeGreaterThan(0);
    expect(wedNew.length).toBeGreaterThan(0);
    expect(monNew.every(r => r.recurrence_frequency === "weekly")).toBe(true);
    expect(wedNew.every(r => r.recurrence_frequency === "monthly")).toBe(true);
    // Stride respected per slot: weekly ones cluster densely, monthly
    // ones spaced ~28d apart.
    const monIsos = monNew.map(r => isoFromShortDate(r.date, ctx.today)).sort();
    if (monIsos.length >= 2) {
      const gap = (new Date(monIsos[1]).getTime() - new Date(monIsos[0]).getTime()) / DAY_MS;
      expect(gap).toBe(7);
    }
    const wedIsos = wedNew.map(r => isoFromShortDate(r.date, ctx.today)).sort();
    if (wedIsos.length >= 2) {
      const gap = (new Date(wedIsos[1]).getTime() - new Date(wedIsos[0]).getTime()) / DAY_MS;
      expect(gap).toBe(28);
    }
  });
});

/* ── Interview-stage / potential patients (migration 047) ──
   These guard the load-bearing invariant that recurring auto-extend
   never picks up an interview row, even if a later code change
   accidentally relaxes one of the upstream filters. */
describe("computeAutoExtendRows — interview rows", () => {
  it("returns [] for a 'potential' patient regardless of inputs", () => {
    const ctx = buildContext(new Date());
    // Even with multiple future scheduled sessions on a slot — the
    // shape that would normally trigger extension — a potential's
    // recurring schedule is NEVER auto-extended.
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient({ status: PATIENT_STATUS.POTENTIAL }),
      allPSess: [
        scheduledMon10(7, ctx.today),
        scheduledMon10(14, ctx.today),
      ],
    });
    expect(rows).toEqual([]);
  });

  it("does NOT mint recurring rows from an interview session on a converted patient", () => {
    // Scenario: the potential has been converted to active, and the
    // pre-conversion interview session is still in the table. The
    // auto-extend filter must skip it (defensive isInterviewSession
    // check + the is_recurring=false primary guard) so no phantom
    // weekly slot gets minted on the interview's day/time.
    const ctx = buildContext(new Date());
    const rows = computeAutoExtendRows({
      ...ctx,
      patient: activePatient(),
      allPSess: [
        // The original interview — Lunes 10:00, one-off, scheduled.
        { ...scheduledMon10(3, ctx.today), session_type: "interview", is_recurring: false },
        // Plus a single regular Mon 10:00 future row — alone,
        // wouldn't be enough to qualify as recurring (need ≥2).
        { ...scheduledMon10(7, ctx.today), session_type: "regular", is_recurring: true, recurrence_frequency: "weekly" },
      ],
    });
    expect(rows).toEqual([]);
  });
});

// Local helper: convert a "D-MMM" short date (Spanish) to ISO using the
// year of `referenceDate`. Tests only — production parsers handle this.
function isoFromShortDate(short: string, referenceDate: Date) {
  const MONTHS: Record<string, number> = { Ene:0, Feb:1, Mar:2, Abr:3, May:4, Jun:5, Jul:6, Ago:7, Sep:8, Oct:9, Nov:10, Dic:11 };
  const [d, m] = short.split("-");
  const monthIdx = MONTHS[m];
  // Pick the year that puts the resulting date closest to referenceDate
  // (within +/- 6 months) so end-of-year wraps work.
  const refYear = referenceDate.getFullYear();
  for (const y of [refYear, refYear + 1, refYear - 1]) {
    const dt = new Date(y, monthIdx, parseInt(d, 10));
    const diffMs = Math.abs(dt.getTime() - referenceDate.getTime());
    if (diffMs < 200 * DAY_MS) return toISODate(dt);
  }
  return toISODate(new Date(refYear, monthIdx, parseInt(d, 10)));
}
