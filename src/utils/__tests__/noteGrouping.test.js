import { describe, it, expect } from "vitest";
import { bucketForDate, bucketLabel, groupNotesByRecency } from "../noteGrouping.js";

const NOW = new Date("2026-04-22T14:00:00");

function iso(date) { return date.toISOString(); }
function daysAgo(n) { const d = new Date(NOW); d.setDate(d.getDate() - n); return iso(d); }
function hoursAgo(n) { const d = new Date(NOW); d.setHours(d.getHours() - n); return iso(d); }

describe("bucketForDate", () => {
  it("today for a note updated minutes ago", () => {
    expect(bucketForDate(hoursAgo(0.1), NOW)).toBe("today");
  });

  it("today for a note updated earlier today", () => {
    expect(bucketForDate(hoursAgo(6), NOW)).toBe("today");
  });

  it("yesterday for exactly one day ago", () => {
    expect(bucketForDate(daysAgo(1), NOW)).toBe("yesterday");
  });

  it("thisWeek for 3-6 days ago", () => {
    expect(bucketForDate(daysAgo(3), NOW)).toBe("thisWeek");
    expect(bucketForDate(daysAgo(6), NOW)).toBe("thisWeek");
  });

  it("thisMonth for notes older than a week in the same month", () => {
    // NOW is April 22 — April 10 is same month, older than a week
    const d = new Date("2026-04-10T12:00:00");
    expect(bucketForDate(iso(d), NOW)).toBe("thisMonth");
  });

  it("lastMonth for March 2026", () => {
    const d = new Date("2026-03-15T12:00:00");
    expect(bucketForDate(iso(d), NOW)).toBe("lastMonth");
  });

  it("month-year bucket for older", () => {
    const d = new Date("2025-12-10T12:00:00");
    expect(bucketForDate(iso(d), NOW)).toBe("2025-12");
  });
});

describe("bucketLabel", () => {
  const t = () => null; // force defaults

  it("returns Spanish defaults for known buckets", () => {
    expect(bucketLabel("today", t, NOW)).toBe("Hoy");
    expect(bucketLabel("yesterday", t, NOW)).toBe("Ayer");
    expect(bucketLabel("thisWeek", t, NOW)).toBe("Esta semana");
    expect(bucketLabel("thisMonth", t, NOW)).toBe("Este mes");
    expect(bucketLabel("lastMonth", t, NOW)).toBe("Mes anterior");
    expect(bucketLabel("pinned", t, NOW)).toBe("Fijadas");
  });

  it("formats YYYY-MM with capitalized Spanish month (same year)", () => {
    // 2026-02 with NOW=2026 → "Febrero"
    expect(bucketLabel("2026-02", t, NOW)).toBe("Febrero");
  });

  it("includes year for older months", () => {
    // 2025-12 with NOW=2026 → "Diciembre de 2025"
    const label = bucketLabel("2025-12", t, NOW);
    expect(label).toContain("Diciembre");
    expect(label).toContain("2025");
  });
});

describe("groupNotesByRecency", () => {
  const t = () => null;

  it("returns empty array for empty input", () => {
    expect(groupNotesByRecency([], t, NOW)).toEqual([]);
    expect(groupNotesByRecency(null, t, NOW)).toEqual([]);
  });

  it("pinned notes float to the top regardless of date", () => {
    const notes = [
      { id: "a", pinned: false, updated_at: hoursAgo(1) },
      { id: "b", pinned: true, updated_at: daysAgo(40) },
      { id: "c", pinned: false, updated_at: daysAgo(2) },
    ];
    const out = groupNotesByRecency(notes, t, NOW);
    expect(out[0].key).toBe("pinned");
    expect(out[0].notes.map(n => n.id)).toEqual(["b"]);
  });

  it("orders buckets: today, yesterday, thisWeek, thisMonth", () => {
    const notes = [
      { id: "1", pinned: false, updated_at: hoursAgo(1) },        // today
      { id: "2", pinned: false, updated_at: daysAgo(1) },         // yesterday
      { id: "3", pinned: false, updated_at: daysAgo(3) },         // thisWeek
      { id: "4", pinned: false, updated_at: "2026-04-01T12:00:00" }, // thisMonth
    ];
    const out = groupNotesByRecency(notes, t, NOW);
    expect(out.map(b => b.key)).toEqual(["today", "yesterday", "thisWeek", "thisMonth"]);
  });

  it("sorts month-year buckets newest first after standard buckets", () => {
    const notes = [
      { id: "a", pinned: false, updated_at: "2025-12-10T12:00:00" }, // 2025-12
      { id: "b", pinned: false, updated_at: "2025-06-10T12:00:00" }, // 2025-06
      { id: "c", pinned: false, updated_at: hoursAgo(1) },           // today
    ];
    const out = groupNotesByRecency(notes, t, NOW);
    expect(out.map(b => b.key)).toEqual(["today", "2025-12", "2025-06"]);
  });

  it("preserves within-bucket input order", () => {
    const notes = [
      { id: "first", pinned: false, updated_at: hoursAgo(0.5) },
      { id: "second", pinned: false, updated_at: hoursAgo(1) },
      { id: "third", pinned: false, updated_at: hoursAgo(2) },
    ];
    const out = groupNotesByRecency(notes, t, NOW);
    expect(out[0].notes.map(n => n.id)).toEqual(["first", "second", "third"]);
  });
});
