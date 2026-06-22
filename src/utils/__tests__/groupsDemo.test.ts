import { describe, it, expect } from "vitest";
import { generateDemoData } from "../../data/demoData";
import { collapseGroupOccurrences, groupOccurrences, groupFinancesRollup, activeMemberCount } from "../groups";
import { enrichPatientsWithBalance } from "../accounting";

/* Integration coverage: the demo seed must produce a real group whose
   occurrences fan out into ordinary session rows, collapse into one Agenda
   tile, and fold into member balances identically to non-group sessions. */
describe("demo groups wiring", () => {
  for (const profession of ["tutor", "psychologist", "music_teacher"]) {
    it(`seeds a working group for ${profession}`, () => {
      const data = generateDemoData(profession);
      const g = data.groups[0];
      expect(g).toBeTruthy();
      expect(activeMemberCount(g, data.groupMembers)).toBeGreaterThanOrEqual(2);

      const groupSessions = data.sessions.filter(s => s.group_id === g.id);
      expect(groupSessions.length).toBeGreaterThan(0);
      // Flat group rate on every member row.
      expect(groupSessions.every(s => s.rate === g.rate)).toBe(true);

      // One day collapses to exactly one tile carrying all attendees.
      const date = groupSessions[0].date, time = groupSessions[0].time;
      const tiles = (collapseGroupOccurrences(
        data.sessions.filter(s => s.date === date), new Map([[g.id, g]])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any[]).filter(x => x._groupOccurrence);
      expect(tiles.length).toBe(1);
      expect(tiles[0].count).toBe(
        data.sessions.filter(s => s.group_id === g.id && s.date === date && s.time === time).length
      );

      expect(groupOccurrences(g, data.sessions).length).toBeGreaterThan(0);
      const pById = new Map(data.patients.map(p => [p.id, p]));
      expect(groupFinancesRollup(g, data.groupMembers, data.sessions, pById).totalConsumed).toBeGreaterThanOrEqual(0);

      // PRIME DIRECTIVE: amountDue is invariant to the group_id tag.
      const mId = data.groupMembers.find(m => m.group_id === g.id).patient_id;
      const withGroup = enrichPatientsWithBalance(data.patients, data.sessions).find(p => p.id === mId).amountDue;
      const stripped = enrichPatientsWithBalance(data.patients, data.sessions.map(s => ({ ...s, group_id: null }))).find(p => p.id === mId).amountDue;
      expect(withGroup).toBe(stripped);
    });
  }
});
