import { describe, it, expect, vi } from "vitest";
import { restoreRows, composeReverts } from "../optimistic";

/** Minimal stand-in for a React setter over a row array: holds state, applies
    the SetStateAction the same way React would, and records calls. */
function stateCell<T>(initial: T[]) {
  let value = initial;
  const set = vi.fn((next: T[] | ((prev: T[]) => T[])) => {
    value = typeof next === "function" ? (next as (p: T[]) => T[])(value) : next;
  });
  return { set, get: () => value };
}

type Row = { id?: string | null; v?: number; paid?: number };

describe("restoreRows", () => {
  it("restores a single updated row in place, leaving siblings untouched", () => {
    const cell = stateCell<Row>([{ id: "a", v: 1 }, { id: "b", v: 1 }]);
    const prevA: Row = { id: "a", v: 0 };
    // Simulate an optimistic update to A, then revert.
    cell.set([{ id: "a", v: 99 }, { id: "b", v: 1 }]);
    restoreRows(cell.set, [prevA])();
    expect(cell.get()).toEqual([{ id: "a", v: 0 }, { id: "b", v: 1 }]);
  });

  it("restores multiple rows by id across one array", () => {
    const cell = stateCell<Row>([{ id: "a", paid: 9 }, { id: "b", paid: 9 }, { id: "c", paid: 1 }]);
    restoreRows(cell.set, [{ id: "a", paid: 0 }, { id: "b", paid: 5 }])();
    expect(cell.get()).toEqual([{ id: "a", paid: 0 }, { id: "b", paid: 5 }, { id: "c", paid: 1 }]);
  });

  it("restore-IF-present: does not re-add a row removed since capture", () => {
    const cell = stateCell<Row>([{ id: "b", v: 1 }]); // 'a' was deleted after capture
    restoreRows(cell.set, [{ id: "a", v: 0 }])();
    // 'a' is gone and must NOT reappear (matches prev.map semantics).
    expect(cell.get()).toEqual([{ id: "b", v: 1 }]);
  });

  it("skips null / undefined / id-less snapshots and no-ops when all skipped", () => {
    const cell = stateCell<Row>([{ id: "a", v: 1 }]);
    restoreRows(cell.set, [null, undefined, { v: 5 }])();
    // Nothing to restore → setter never called, state unchanged.
    expect(cell.set).not.toHaveBeenCalled();
    expect(cell.get()).toEqual([{ id: "a", v: 1 }]);
  });

  it("snapshots are used verbatim — last entry wins on duplicate ids", () => {
    const cell = stateCell<Row>([{ id: "a", v: 99 }]);
    restoreRows(cell.set, [{ id: "a", v: 1 }, { id: "a", v: 2 }])();
    expect(cell.get()).toEqual([{ id: "a", v: 2 }]);
  });

  it("captures the snapshot object by reference at build time (caller owns cloning)", () => {
    // The hooks pass {...row} clones; restoreRows stores whatever it's given.
    const cell = stateCell<Row>([{ id: "a", v: 99 }]);
    const snap: Row = { id: "a", v: 0 };
    const revert = restoreRows(cell.set, [snap]);
    revert();
    expect(cell.get()[0]).toBe(snap); // the exact snapshot object is written back
  });
});

describe("composeReverts", () => {
  it("runs every revert in argument order", () => {
    const order: string[] = [];
    const revert = composeReverts(
      () => order.push("payments"),
      () => order.push("patients"),
    );
    revert();
    expect(order).toEqual(["payments", "patients"]);
  });

  it("composes reverts across two independent state arrays (the payment-edit shape)", () => {
    const payments = stateCell<Row>([{ id: "p1", paid: 0 }]);
    const patients = stateCell<Row>([{ id: "u1", paid: 0 }, { id: "u2", paid: 0 }]);
    // Optimistic edit moved p1 + bumped both patients; now revert all of it.
    payments.set([{ id: "p1", paid: 500 }]);
    patients.set([{ id: "u1", paid: 500 }, { id: "u2", paid: 300 }]);
    composeReverts(
      restoreRows(payments.set, [{ id: "p1", paid: 0 }]),
      restoreRows(patients.set, [{ id: "u1", paid: 0 }, { id: "u2", paid: 0 }]),
    )();
    expect(payments.get()).toEqual([{ id: "p1", paid: 0 }]);
    expect(patients.get()).toEqual([{ id: "u1", paid: 0 }, { id: "u2", paid: 0 }]);
  });

  it("an empty composition is a safe no-op", () => {
    expect(() => composeReverts()()).not.toThrow();
  });
});
