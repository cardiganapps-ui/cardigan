/* Tests for the widget snapshot builder — the single contract shared by
   the native App Group writer (src/lib/widgetSync.ts), the network
   endpoint (api/widget-data.ts), and the Swift decoder. Money numbers
   ride the canonical accounting predicate, so the balance cases here
   mirror the Prime Directive rules: charged always counts, cancelled
   never, past-scheduled counts after the +1h grace, opening_balance
   folds into amountDue.

   Determinism: `now` is pinned and `tz` is the runner's own zone, so
   the internal toLocaleString round-trip is a wall-clock identity in
   any CI timezone. */

import { describe, it, expect } from "vitest";
import { buildWidgetSnapshot, WIDGET_SNAPSHOT_VERSION } from "../widgetSnapshot";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Wednesday 15-Abr-2026, 12:00 local.
const NOW = new Date(2026, 3, 15, 12, 0);

const build = (over: Record<string, unknown> = {}) =>
  buildWidgetSnapshot({
    sessions: [],
    patients: [],
    payments: [],
    tz: TZ,
    now: NOW,
    ...over,
  });

describe("buildWidgetSnapshot — envelope", () => {
  it("returns the versioned envelope with Spanish labels", () => {
    const snap = build();
    expect(snap.v).toBe(WIDGET_SNAPSHOT_VERSION);
    expect(snap.generatedAt).toBe(NOW.toISOString());
    expect(snap.tz).toBe(TZ);
    expect(snap.todayLabel).toBe("Miércoles 15-Abr");
    expect(snap.kpis.monthLabel).toBe("Abril");
    expect(snap.kpis.currency).toBe("MXN");
  });

  it("empty account → zeroed KPIs, no next session, 7 zeroed week days", () => {
    const snap = build();
    expect(snap.sessionsToday).toEqual([]);
    expect(snap.nextSession).toBeNull();
    expect(snap.kpis).toMatchObject({
      sessionsToday: 0, activePatients: 0, collectedMonth: 0,
      pendingTotal: 0, owingPatients: 0,
    });
    expect(snap.week).toHaveLength(7);
    expect(snap.week.map(w => w.d)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    expect(snap.week.every(w => w.count === 0)).toBe(true);
    expect(snap.week[2].isToday).toBe(true); // Wednesday
  });
});

describe("buildWidgetSnapshot — today's agenda", () => {
  const sessions = [
    { id: "s2", patient_id: "p1", patient: "Ana López", initials: "AL", time: "16:00", date: "15-Abr", status: "scheduled", modality: "virtual" },
    { id: "s1", patient_id: "p1", patient: "Ana López", initials: "AL", time: "09:00", date: "15-Abr", status: "scheduled" },
    { id: "s3", patient_id: "p2", patient: "Beto Ruiz", initials: "BR", time: "11:30", date: "15 Abr", status: "completed" },
    { id: "s4", patient_id: "p2", patient: "Beto Ruiz", initials: "BR", time: "10:00", date: "15-Abr", status: "cancelled" },
    { id: "s5", patient_id: "p1", patient: "Ana López", initials: "AL", time: "10:00", date: "16-Abr", status: "scheduled" },
  ];

  it("includes both date spellings, sorts by time, keeps cancelled rows (KPI parity with Home)", () => {
    const snap = build({ sessions });
    expect(snap.sessionsToday.map(s => s.id)).toEqual(["s1", "s4", "s3", "s2"]);
    expect(snap.kpis.sessionsToday).toBe(4);
    expect(snap.sessionsToday[1].status).toBe("cancelled");
    expect(snap.sessionsToday[3].modality).toBe("virtual");
  });

  it("display-completes a past scheduled slot after the +1h grace (pixels only)", () => {
    const snap = build({ sessions });
    const s1 = snap.sessionsToday.find(s => s.id === "s1");
    const s2 = snap.sessionsToday.find(s => s.id === "s2");
    expect(s1?.status).toBe("completed"); // 09:00 + 1h ≤ 12:00
    expect(s2?.status).toBe("scheduled"); // 16:00 still ahead
  });

  it("grace boundary: 11:00 flips exactly at 12:00; 11:01 does not", () => {
    const rows = [
      { id: "a", patient_id: "p", patient: "X", time: "11:00", date: "15-Abr", status: "scheduled" },
      { id: "b", patient_id: "p", patient: "X", time: "11:01", date: "15-Abr", status: "scheduled" },
    ];
    const snap = build({ sessions: rows });
    expect(snap.sessionsToday.find(s => s.id === "a")?.status).toBe("completed");
    expect(snap.sessionsToday.find(s => s.id === "b")?.status).toBe("scheduled");
  });

  it("derives the collapsed group status from all attendees, not the first row", () => {
    // First attendee (by array order) cancelled, but another still
    // scheduled → the occurrence must NOT read as cancelled.
    const rows = [
      { id: "g1", patient_id: "p1", patient: "Ana", time: "18:00", date: "15-Abr", status: "cancelled", group_id: "G", groups: { name: "Grupo" } },
      { id: "g2", patient_id: "p2", patient: "Beto", time: "18:00", date: "15-Abr", status: "scheduled", group_id: "G", groups: { name: "Grupo" } },
    ];
    const snap = build({ sessions: rows });
    expect(snap.sessionsToday).toHaveLength(1);
    expect(snap.sessionsToday[0].status).toBe("scheduled");
  });

  it("collapsed group reads cancelled only when every attendee cancelled", () => {
    const rows = [
      { id: "g1", patient_id: "p1", patient: "Ana", time: "18:00", date: "15-Abr", status: "cancelled", group_id: "G", groups: { name: "Grupo" } },
      { id: "g2", patient_id: "p2", patient: "Beto", time: "18:00", date: "15-Abr", status: "cancelled", group_id: "G", groups: { name: "Grupo" } },
    ];
    const snap = build({ sessions: rows });
    expect(snap.sessionsToday[0].status).toBe("cancelled");
  });

  it("collapses group occurrences into one entry named after the group", () => {
    const rows = [
      { id: "g1", patient_id: "p1", patient: "Ana", time: "18:00", date: "15-Abr", status: "scheduled", group_id: "G", groups: { name: "Terapia grupal" } },
      { id: "g2", patient_id: "p2", patient: "Beto", time: "18:00", date: "15-Abr", status: "scheduled", group_id: "G", groups: { name: "Terapia grupal" } },
    ];
    const snap = build({ sessions: rows });
    expect(snap.sessionsToday).toHaveLength(1);
    expect(snap.sessionsToday[0].patientName).toBe("Terapia grupal");
    expect(snap.sessionsToday[0].isGroup).toBe(true);
  });
});

describe("buildWidgetSnapshot — next session", () => {
  it("picks the earliest still-upcoming scheduled slot today", () => {
    const snap = build({
      sessions: [
        { id: "late", patient_id: "p", patient: "X", time: "16:00", date: "15-Abr", status: "scheduled" },
        { id: "soon", patient_id: "p", patient: "X", time: "13:00", date: "15-Abr", status: "scheduled" },
        { id: "past", patient_id: "p", patient: "X", time: "09:00", date: "15-Abr", status: "scheduled" },
      ],
    });
    expect(snap.nextSession?.id).toBe("soon");
    expect(snap.nextSession?.dayLabel).toBe("Hoy");
    expect(snap.nextSession?.isToday).toBe(true);
    expect(snap.nextSession?.status).toBe("scheduled");
  });

  it("falls through to tomorrow with dayLabel Mañana (isToday false)", () => {
    const snap = build({
      sessions: [{ id: "t", patient_id: "p", patient: "X", time: "10:00", date: "16-Abr", status: "scheduled" }],
    });
    expect(snap.nextSession?.id).toBe("t");
    expect(snap.nextSession?.dayLabel).toBe("Mañana");
    expect(snap.nextSession?.isToday).toBe(false);
  });

  it("uses the weekday name beyond tomorrow and skips non-scheduled rows", () => {
    const snap = build({
      sessions: [
        { id: "c", patient_id: "p", patient: "X", time: "10:00", date: "16-Abr", status: "cancelled" },
        { id: "sat", patient_id: "p", patient: "X", time: "09:00", date: "18-Abr", status: "scheduled" },
      ],
    });
    expect(snap.nextSession?.id).toBe("sat");
    expect(snap.nextSession?.dayLabel).toBe("Sábado");
  });

  it("null when nothing is scheduled within 7 days", () => {
    const snap = build({
      sessions: [{ id: "far", patient_id: "p", patient: "X", time: "10:00", date: "30-Abr", status: "scheduled" }],
    });
    expect(snap.nextSession).toBeNull();
  });
});

describe("buildWidgetSnapshot — tutor sessions", () => {
  it("flags a 'T·'-prefixed session as tutor and strips the prefix from initials", () => {
    const snap = build({
      sessions: [
        { id: "tut", patient_id: "p", patient: "Diego Ramírez", initials: "T·DR", time: "13:00", date: "15-Abr", status: "scheduled" },
        { id: "reg", patient_id: "p2", patient: "Ana López", initials: "AL", time: "14:00", date: "15-Abr", status: "scheduled" },
      ],
    });
    const tut = snap.sessionsToday.find((s) => s.id === "tut");
    const reg = snap.sessionsToday.find((s) => s.id === "reg");
    expect(tut?.isTutor).toBe(true);
    expect(tut?.initials).toBe("DR");
    expect(reg?.isTutor).toBeUndefined();
    expect(reg?.initials).toBe("AL");
  });
});

describe("buildWidgetSnapshot — week occupancy", () => {
  it("counts scheduled+completed per day Lun–Dom, excluding cancelled/charged, collapsing groups", () => {
    const snap = build({
      sessions: [
        { id: "1", patient_id: "p", patient: "X", time: "09:00", date: "13-Abr", status: "completed" },  // Mon
        { id: "2", patient_id: "p", patient: "X", time: "10:00", date: "15-Abr", status: "scheduled" },  // Wed
        { id: "3", patient_id: "p", patient: "X", time: "11:00", date: "15 Abr", status: "scheduled" },  // Wed legacy
        { id: "4", patient_id: "p", patient: "X", time: "12:00", date: "15-Abr", status: "cancelled" },  // excluded
        { id: "5", patient_id: "p", patient: "X", time: "13:00", date: "17-Abr", status: "charged" },    // excluded
        { id: "g1", patient_id: "p", patient: "X", time: "18:00", date: "19-Abr", status: "scheduled", group_id: "G" }, // Sun
        { id: "g2", patient_id: "q", patient: "Y", time: "18:00", date: "19-Abr", status: "scheduled", group_id: "G" }, // collapsed
        { id: "old", patient_id: "p", patient: "X", time: "09:00", date: "10-Ene", status: "scheduled", created_at: "2026-01-05T00:00:00Z" },
      ],
    });
    expect(snap.week.map(w => w.count)).toEqual([1, 0, 2, 0, 0, 0, 1]);
  });
});

describe("buildWidgetSnapshot — money KPIs (Prime Directive)", () => {
  it("derives pendingTotal from raw sessions with the canonical predicate", () => {
    const snap = build({
      sessions: [
        // consumed: past-scheduled at patient rate (700)
        { id: "s1", patient_id: "p1", patient: "Ana", time: "09:00", date: "15-Abr", status: "scheduled" },
        // consumed: completed with explicit per-session rate (500)
        { id: "s3", patient_id: "p1", patient: "Ana", time: "11:30", date: "15 Abr", status: "completed", rate: 500 },
        // charged counts regardless of (future) date
        { id: "ch", patient_id: "p1", patient: "Ana", time: "10:00", date: "20-Abr", status: "charged", rate: 300 },
        // cancelled never counts; future scheduled never counts
        { id: "cx", patient_id: "p1", patient: "Ana", time: "10:00", date: "15-Abr", status: "cancelled" },
        { id: "fu", patient_id: "p1", patient: "Ana", time: "16:00", date: "15-Abr", status: "scheduled" },
      ],
      patients: [
        // consumed 1500 − paid 700 → owes 800
        { id: "p1", status: "active", rate: 700, paid: 700 },
        // opening balance alone → owes 300
        { id: "p3", status: "active", rate: 700, paid: 0, opening_balance: 300 },
        // prepaid → credit, owes 0
        { id: "p4", status: "ended", rate: 700, paid: 1400 },
      ],
    });
    expect(snap.kpis.pendingTotal).toBe(1100);
    expect(snap.kpis.owingPatients).toBe(2);
    expect(snap.kpis.activePatients).toBe(2);
  });

  it("excludes potential/discarded patients from the outstanding lane (Home parity)", () => {
    const snap = build({
      sessions: [
        { id: "iv", patient_id: "pot", patient: "Nuevo", time: "09:00", date: "15-Abr", status: "completed" },
      ],
      patients: [{ id: "pot", status: "potential", rate: 700, paid: 0 }],
    });
    expect(snap.kpis.pendingTotal).toBe(0);
    expect(snap.kpis.owingPatients).toBe(0);
  });

  // bug-hunt: the balance reference must be the tz-adjusted wall clock,
  // not the raw UTC instant — otherwise on a UTC server a session near
  // its hour counts toward "Por cobrar" hours early. This is a
  // differential test: same instant + sessions, only tz differs. Because
  // both calls share the runner's tz for building sessionEndMoment, the
  // ONLY thing that can move pendingTotal is the reference we pass in —
  // which pre-fix was a tz-independent raw `now` (identical → bug), and
  // post-fix is the tz wall clock (differs). Runner-tz independent.
  it("computes pending balance against the tz wall clock, not raw UTC", () => {
    // A patient with one scheduled session dated today at 12:00 whose
    // consumed-ness the two references straddle: at this instant the UTC
    // wall clock is well past 13:00 (session end) while the UTC-12 wall
    // clock is still in the early morning.
    const instant = new Date("2026-07-15T18:30:00Z");
    const sessionRow = (tz: string) => {
      // Date string must match the builder's today-key in that tz.
      const wall = new Date(instant.toLocaleString("en-US", { timeZone: tz }));
      const short = `${wall.getDate()}-${["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][wall.getMonth()]}`;
      return { id: "s1", patient_id: "p1", patient: "Ana", time: "12:00", date: short, status: "scheduled", created_at: instant.toISOString() };
    };
    const patients = [{ id: "p1", status: "active", rate: 700, paid: 0 }];

    const east = buildWidgetSnapshot({ sessions: [sessionRow("UTC")], patients, payments: [], tz: "UTC", now: instant });
    const west = buildWidgetSnapshot({ sessions: [sessionRow("Etc/GMT+12")], patients, payments: [], tz: "Etc/GMT+12", now: instant });

    // UTC: 18:30 wall > 13:00 end → session consumed → owes 700.
    expect(east.kpis.pendingTotal).toBe(700);
    // UTC-12: 06:30 wall < 13:00 end → not yet consumed → owes 0.
    expect(west.kpis.pendingTotal).toBe(0);
  });

  it("collectedMonth buckets by created_at with short-date fallback for legacy rows", () => {
    const snap = build({
      payments: [
        { amount: 800, created_at: new Date(2026, 3, 3, 10, 0).toISOString() },   // April → in
        { amount: 200, created_at: new Date(2026, 2, 28, 10, 0).toISOString() },  // March → out
        { amount: 150, date: "3-Abr" },                                            // legacy, April → in
        { amount: 999, date: "3 Mar" },                                            // legacy, March → out
      ],
    });
    expect(snap.kpis.collectedMonth).toBe(950);
  });
});
