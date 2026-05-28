import { describe, it, expect } from "vitest";
import { classifySessions } from "../patientPortal";

/* classifySessions splits a patient's sessions into "future" (still
   scheduled, slot hasn't passed) and "past" (completed / cancelled
   / charged, OR scheduled-but-past via the auto-complete predicate).
   The patient home reads from the result to render the next-session
   hero + the past-sessions list, so getting this right is what
   keeps the UI honest about "what's next." */

const PATIENT_ID = "p-1";

function future(date, time = "10:00") {
  return { id: `f-${date}-${time}`, patient_id: PATIENT_ID, date, time, status: "scheduled" };
}
function past(date, time = "10:00", status = "completed") {
  return { id: `p-${date}-${time}`, patient_id: PATIENT_ID, date, time, status };
}

// Pin "now" to a fixed timestamp + thread it through classifySessions's
// optional `nowOverride` param so "session at NOW+7" assertions stay
// stable regardless of when the test runs. Without injection, the
// classifier reads the real system clock while the test data is built
// off NOW — the gap widens day by day and bucket counts eventually flip.
const NOW = new Date("2026-05-07T12:00:00Z");
function shortFromOffset(daysAhead) {
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return `${d.getUTCDate()}-${months[d.getUTCMonth()]}`;
}

describe("classifySessions", () => {
  it("returns empty future + past for empty input", () => {
    const r = classifySessions([], [PATIENT_ID], NOW);
    expect(r.future).toEqual([]);
    expect(r.past).toEqual([]);
  });

  it("filters out sessions for other patients", () => {
    const sessions = [
      { id: "x", patient_id: "p-other", date: "1-Jun", time: "10:00", status: "scheduled" },
    ];
    const r = classifySessions(sessions, [PATIENT_ID], NOW);
    expect(r.future).toEqual([]);
    expect(r.past).toEqual([]);
  });

  it("buckets a clearly-future scheduled session into future", () => {
    const dateStr = shortFromOffset(7); // 7 days from NOW
    const s = future(dateStr, "14:00");
    const r = classifySessions([s], [PATIENT_ID], NOW);
    expect(r.future).toHaveLength(1);
    expect(r.past).toHaveLength(0);
  });

  it("buckets a completed past session into past", () => {
    const dateStr = shortFromOffset(-5);
    const s = past(dateStr, "10:00", "completed");
    const r = classifySessions([s], [PATIENT_ID], NOW);
    expect(r.future).toHaveLength(0);
    expect(r.past).toHaveLength(1);
  });

  it("buckets a cancelled session into past regardless of date", () => {
    const dateStr = shortFromOffset(10); // future date
    const s = { id: "c-1", patient_id: PATIENT_ID, date: dateStr, time: "10:00", status: "cancelled" };
    const r = classifySessions([s], [PATIENT_ID], NOW);
    // Cancelled doesn't appear as a future appointment; it's a
    // historical event with status=cancelled.
    expect(r.future).toHaveLength(0);
    expect(r.past).toHaveLength(1);
  });

  it("buckets a charged session into past regardless of date", () => {
    const dateStr = shortFromOffset(10);
    const s = { id: "ch-1", patient_id: PATIENT_ID, date: dateStr, time: "10:00", status: "charged" };
    const r = classifySessions([s], [PATIENT_ID], NOW);
    expect(r.past).toHaveLength(1);
  });

  it("handles multiple patient ids (multi-therapist scaffold)", () => {
    const sessions = [
      { id: "a", patient_id: "p-1", date: shortFromOffset(7), time: "10:00", status: "scheduled" },
      { id: "b", patient_id: "p-2", date: shortFromOffset(8), time: "11:00", status: "scheduled" },
      { id: "c", patient_id: "p-3", date: shortFromOffset(9), time: "12:00", status: "scheduled" },
    ];
    const r = classifySessions(sessions, ["p-1", "p-2"], NOW);
    expect(r.future).toHaveLength(2);
    expect(r.past).toHaveLength(0);
  });
});
