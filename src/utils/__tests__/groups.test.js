import { describe, it, expect } from "vitest";
import { buildGroupRoster, activeMemberCount, groupOccurrences, groupFinancesRollup, collapseGroupOccurrences } from "../groups";
import { enrichPatientsWithBalance } from "../accounting";
import { SESSION_STATUS } from "../../data/constants";

const patientsById = new Map([
  ["pa", { id: "pa", name: "Ana", rate: 500 }],
  ["pb", { id: "pb", name: "Beto", rate: 500 }],
]);

const grp = { id: "g1", name: "Grupo", rate: 500 };

const gm = [
  { id: "m1", group_id: "g1", patient_id: "pa", left_at: null },
  { id: "m2", group_id: "g1", patient_id: "pb", left_at: "2020-01-01" },
  { id: "m3", group_id: "other", patient_id: "pa", left_at: null },
];

describe("buildGroupRoster / activeMemberCount", () => {
  it("hydrates members for the group with active-first ordering", () => {
    const roster = buildGroupRoster(grp, gm, patientsById);
    expect(roster.members.length).toBe(2);
    expect(roster.members[0].active).toBe(true);
    expect(roster.members[0].patient.name).toBe("Ana");
  });
  it("counts only active members", () => {
    expect(activeMemberCount(grp, gm)).toBe(1);
  });
});

describe("groupOccurrences", () => {
  const now = new Date("2026-06-15T12:00:00");
  const sessions = [
    // Past occurrence — both attended (completed)
    { id: "s1", group_id: "g1", patient_id: "pa", date: "1-Jun", time: "10:00", status: SESSION_STATUS.COMPLETED, rate: 500 },
    { id: "s2", group_id: "g1", patient_id: "pb", date: "1-Jun", time: "10:00", status: SESSION_STATUS.COMPLETED, rate: 500 },
    // Future occurrence — both scheduled
    { id: "s3", group_id: "g1", patient_id: "pa", date: "20-Jun", time: "10:00", status: SESSION_STATUS.SCHEDULED, rate: 500 },
    { id: "s4", group_id: "g1", patient_id: "pb", date: "20-Jun", time: "10:00", status: SESSION_STATUS.SCHEDULED, rate: 500 },
    // A different group's row must be ignored
    { id: "s5", group_id: "other", patient_id: "pa", date: "20-Jun", time: "10:00", status: SESSION_STATUS.SCHEDULED, rate: 500 },
  ];

  it("reduces rows into occurrences keyed by (date,time), newest first", () => {
    const occs = groupOccurrences(grp, sessions, now);
    expect(occs.length).toBe(2);
    expect(occs[0].date).toBe("20-Jun"); // newest first
    expect(occs[0].count).toBe(2);
    expect(occs[0].status).toBe(SESSION_STATUS.SCHEDULED);
    expect(occs[1].status).toBe(SESSION_STATUS.COMPLETED);
  });

  it("marks an occurrence cancelled only when all attendees are cancelled", () => {
    const cancelled = [
      { id: "c1", group_id: "g1", patient_id: "pa", date: "20-Jun", time: "10:00", status: SESSION_STATUS.CANCELLED },
      { id: "c2", group_id: "g1", patient_id: "pb", date: "20-Jun", time: "10:00", status: SESSION_STATUS.CANCELLED },
    ];
    expect(groupOccurrences(grp, cancelled, now)[0].status).toBe(SESSION_STATUS.CANCELLED);
  });
});

describe("groupFinancesRollup", () => {
  it("sums consumed per member using the canonical predicate", () => {
    const now = new Date("2026-06-15T12:00:00");
    const sessions = [
      { id: "s1", group_id: "g1", patient_id: "pa", date: "1-Jun", time: "10:00", status: SESSION_STATUS.COMPLETED, rate: 500 },
      { id: "s2", group_id: "g1", patient_id: "pa", date: "20-Jun", time: "10:00", status: SESSION_STATUS.SCHEDULED, rate: 500 }, // future → not consumed
    ];
    const roll = groupFinancesRollup(grp, gm, sessions, patientsById, now);
    const ana = roll.perMember.find(m => m.patientId === "pa");
    expect(ana.consumed).toBe(500); // only the completed one counts
    expect(ana.sessions).toBe(2);
    expect(roll.totalConsumed).toBe(500);
  });
});

describe("collapseGroupOccurrences", () => {
  const gById = new Map([["g1", { id: "g1", name: "Clase", color_idx: 2 }]]);
  it("collapses N member rows of one occurrence into a single tile, order preserved", () => {
    const day = [
      { id: "a", patient_id: "pa", date: "1-Jun", time: "09:00", status: "scheduled" }, // solo
      { id: "b", group_id: "g1", patient_id: "pa", date: "1-Jun", time: "10:00", status: "scheduled" },
      { id: "c", group_id: "g1", patient_id: "pb", date: "1-Jun", time: "10:00", status: "scheduled" },
      { id: "d", patient_id: "pc", date: "1-Jun", time: "11:00", status: "scheduled" }, // solo
    ];
    const out = collapseGroupOccurrences(day, gById);
    expect(out.length).toBe(3); // solo + 1 group tile + solo
    expect(out[0].id).toBe("a");
    expect(out[1]._groupOccurrence).toBe(true);
    expect(out[1].count).toBe(2);
    expect(out[1].group.name).toBe("Clase");
    expect(out[2].id).toBe("d");
  });
  it("passes non-group rows through untouched", () => {
    const out = collapseGroupOccurrences([{ id: "x", date: "1-Jun", time: "09:00", status: "scheduled" }], gById);
    expect(out).toHaveLength(1);
    expect(out[0]._groupOccurrence).toBeUndefined();
  });
  it("keeps two different groups at different times separate", () => {
    const gMap = new Map([["g1", { id: "g1", name: "A" }], ["g2", { id: "g2", name: "B" }]]);
    const out = collapseGroupOccurrences([
      { id: "1", group_id: "g1", date: "1-Jun", time: "10:00", status: "scheduled" },
      { id: "2", group_id: "g2", date: "1-Jun", time: "12:00", status: "scheduled" },
    ], gMap);
    expect(out.filter(o => o._groupOccurrence)).toHaveLength(2);
  });
});

// PRIME DIRECTIVE: a group session is an ordinary session in accounting.
// amountDue must be identical whether the row carries group_id or not.
describe("group rows are accounting-invariant", () => {
  it("enrichPatientsWithBalance produces the same amountDue with or without group_id", () => {
    const now = new Date("2026-06-15T12:00:00");
    const patients = [{ id: "pa", rate: 500, paid: 0 }];
    const base = { patient_id: "pa", date: "1-Jun", time: "10:00", status: SESSION_STATUS.COMPLETED, rate: 500 };

    const withoutGroup = enrichPatientsWithBalance(patients, [{ ...base, id: "x1" }], now);
    const withGroup = enrichPatientsWithBalance(patients, [{ ...base, id: "x2", group_id: "g1" }], now);

    expect(withGroup[0].amountDue).toBe(withoutGroup[0].amountDue);
    expect(withGroup[0].amountDue).toBe(500);
  });
});
