import { describe, it, expect } from "vitest";
import { patientMatchesLane, comparePatients, comparePatientsByDebt, filterPatients } from "../patientFilter";
import { PATIENT_STATUS } from "../../data/constants";

const p = (name: string, status: string, amountDue = 0) => ({ name, status, amountDue });

describe("patientMatchesLane", () => {
  it("'all' shows regular patients but excludes potentials/discarded", () => {
    expect(patientMatchesLane(p("A", "active"), "all", "active")).toBe(true);
    expect(patientMatchesLane(p("B", "ended"), "all", "active")).toBe(true);
    expect(patientMatchesLane(p("C", PATIENT_STATUS.POTENTIAL), "all", "active")).toBe(false);
    expect(patientMatchesLane(p("D", PATIENT_STATUS.DISCARDED), "all", "active")).toBe(false);
  });

  it("'owes' / 'paid' split on amountDue and still exclude potentials", () => {
    expect(patientMatchesLane(p("A", "active", 100), "owes", "active")).toBe(true);
    expect(patientMatchesLane(p("A", "active", 0), "owes", "active")).toBe(false);
    expect(patientMatchesLane(p("A", "active", 0), "paid", "active")).toBe(true);
    expect(patientMatchesLane(p("A", "active", 100), "paid", "active")).toBe(false);
    // a potential that happens to owe never shows in the 'owes' lane
    expect(patientMatchesLane(p("X", PATIENT_STATUS.POTENTIAL, 999), "owes", "active")).toBe(false);
  });

  it("'active' / 'ended' match status exactly", () => {
    expect(patientMatchesLane(p("A", "active"), "active", "active")).toBe(true);
    expect(patientMatchesLane(p("A", "ended"), "active", "active")).toBe(false);
    expect(patientMatchesLane(p("A", "ended"), "ended", "active")).toBe(true);
  });

  it("'potential' lane switches on the sub-filter (active vs archived)", () => {
    expect(patientMatchesLane(p("A", PATIENT_STATUS.POTENTIAL), "potential", "active")).toBe(true);
    expect(patientMatchesLane(p("A", PATIENT_STATUS.DISCARDED), "potential", "active")).toBe(false);
    // archived sub-filter shows discarded, not active potentials
    expect(patientMatchesLane(p("A", PATIENT_STATUS.DISCARDED), "potential", "archived")).toBe(true);
    expect(patientMatchesLane(p("A", PATIENT_STATUS.POTENTIAL), "potential", "archived")).toBe(false);
  });
});

describe("comparePatients", () => {
  it("sorts active patients ahead of non-active, then alphabetical", () => {
    const list = [p("Zoe", "ended"), p("Bea", "active"), p("Ana", "ended"), p("Carlos", "active")];
    const sorted = [...list].sort(comparePatients).map(x => x.name);
    expect(sorted).toEqual(["Bea", "Carlos", "Ana", "Zoe"]);
  });
});

describe("filterPatients", () => {
  const roster = [
    p("Ana López", "active", 0),
    p("Bruno Díaz", "active", 500),
    p("Carla Ruiz", "ended", 0),
    p("Diego Sol", PATIENT_STATUS.POTENTIAL, 0),
    p("Eva Mora", PATIENT_STATUS.DISCARDED, 0),
  ];

  it("applies search (case-insensitive substring) + lane + sort together", () => {
    expect(filterPatients(roster, { search: "", filter: "all", potentialSubFilter: "active" }).map(x => x.name))
      .toEqual(["Ana López", "Bruno Díaz", "Carla Ruiz"]); // actives first (alpha), then ended; potential/discarded excluded
    expect(filterPatients(roster, { search: "díaz", filter: "all", potentialSubFilter: "active" }).map(x => x.name))
      .toEqual(["Bruno Díaz"]);
    expect(filterPatients(roster, { search: "", filter: "owes", potentialSubFilter: "active" }).map(x => x.name))
      .toEqual(["Bruno Díaz"]);
    expect(filterPatients(roster, { search: "", filter: "potential", potentialSubFilter: "active" }).map(x => x.name))
      .toEqual(["Diego Sol"]);
    expect(filterPatients(roster, { search: "", filter: "potential", potentialSubFilter: "archived" }).map(x => x.name))
      .toEqual(["Eva Mora"]);
  });

  it("does not mutate the input array", () => {
    const before = roster.map(x => x.name);
    filterPatients(roster, { search: "", filter: "all", potentialSubFilter: "active" });
    expect(roster.map(x => x.name)).toEqual(before);
  });
});

describe("comparePatientsByDebt", () => {
  it("orders by amountDue desc regardless of status, name as tiebreak", () => {
    const roster = [
      p("Ana López", "active", 0),
      p("Bruno Díaz", "ended", 900),   // ended but owing outranks active at zero
      p("Carla Ruiz", "active", 500),
      p("Zoe Vega", "active", 500),    // same debt as Carla → alphabetical
    ];
    expect([...roster].sort(comparePatientsByDebt).map(x => x.name))
      .toEqual(["Bruno Díaz", "Carla Ruiz", "Zoe Vega", "Ana López"]);
  });

  it("filterPatients honours sort: 'debt' and defaults to name sort otherwise", () => {
    const roster = [
      p("Ana López", "active", 0),
      p("Bruno Díaz", "active", 900),
    ];
    expect(filterPatients(roster, { search: "", filter: "all", potentialSubFilter: "active", sort: "debt" }).map(x => x.name))
      .toEqual(["Bruno Díaz", "Ana López"]);
    expect(filterPatients(roster, { search: "", filter: "all", potentialSubFilter: "active" }).map(x => x.name))
      .toEqual(["Ana López", "Bruno Díaz"]);
  });
});
