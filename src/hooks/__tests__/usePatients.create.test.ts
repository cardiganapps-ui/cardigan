/**
 * @vitest-environment happy-dom
 *
 * WS-3: patient creation goes through the transactional
 * create_patient_with_sessions RPC (migration 083) instead of the old
 * insert-patient → insert-sessions two-step that could orphan a patient on
 * a mid-flight failure. These lock the client contract:
 *   • duplicate-name is rejected before any network call,
 *   • the RPC payload never carries user_id (forced from the JWT server-side),
 *   • patient + sessions land in state from the RPC result, camelCased,
 *   • an RPC error leaves NO partial state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
const mock = makeSupabaseMock();

vi.mock("../../supabaseClient", () => ({ get supabase() { return mock.supabase; } }));
vi.mock("../../lib/analytics", () => ({ track: () => {} }));

const { createPatientActions } = await import("../usePatients");

const helpers = {
  formatShortDate: (d: Date) => `${d.getUTCDate()}-Jul`,
  getRecurringDates: () => [new Date("2026-07-06T12:00:00Z"), new Date("2026-07-13T12:00:00Z")],
};

function seed({ patients = [] as Row[] } = {}) {
  const patientsH = makeStateHolder(patients);
  const sessionsH = makeStateHolder([] as Row[]);
  const mutating = makeStateHolder(false);
  const error = makeStateHolder("");
  const actions = createPatientActions(
    "user-1", patientsH.get(), patientsH,
    sessionsH.get(), sessionsH,
    [], undefined, [], undefined,
    mutating, error, helpers as Row,
  );
  return { actions, patientsH, sessionsH, error };
}

const recurringArgs = {
  rate: 500, recurring: true, startDate: "2026-07-01",
  schedules: [{ day: "Lunes", time: "16:00" }], schedulingMode: "recurring",
};

beforeEach(() => mock.reset());

describe("createPatient — transactional RPC", () => {
  it("rejects a duplicate name without calling the RPC", async () => {
    const ctx = seed({ patients: [{ id: "p0", name: "Ana López", sessions: 0, billed: 0 }] });
    const ok = await ctx.actions.createPatient({ name: "  ana lópez  ", rate: 500 });
    expect(ok).toBe(false);
    expect(ctx.error.get()).toMatch(/ya existe/i);
    expect(mock.calls.filter((c: Row) => c.rpc)).toHaveLength(0);
  });

  it("sends a JWT-safe payload and lands patient + sessions from the RPC result", async () => {
    const ctx = seed();
    mock.enqueue("rpc:create_patient_with_sessions", {
      data: {
        patient: { id: "p-new", name: "Beto", color_idx: 0, sessions: 2, billed: 0, rate: 500 },
        sessions: [
          { id: "s1", patient_id: "p-new", date: "6-Jul", color_idx: 0, modality: "presencial" },
          { id: "s2", patient_id: "p-new", date: "13-Jul", color_idx: 0, modality: "presencial" },
        ],
      },
      error: null,
    });

    const ok = await ctx.actions.createPatient({ name: "Beto", ...recurringArgs });

    expect(ok).toBe(true);
    const call = mock.calls.find((c: Row) => c.rpc === "create_patient_with_sessions");
    expect(call).toBeTruthy();
    // user_id is forced server-side from auth.uid() — never in the payload.
    expect(call.args.p_patient.user_id).toBeUndefined();
    expect(call.args.p_patient.name).toBe("Beto");
    expect(call.args.p_sessions).toHaveLength(2);
    // Patient + sessions land from the RPC result, camelCased to UI shape.
    expect(ctx.patientsH.get()).toHaveLength(1);
    expect(ctx.patientsH.get()[0].id).toBe("p-new");
    expect(ctx.patientsH.get()[0].colorIdx).toBe(0);
    expect(ctx.sessionsH.get()).toHaveLength(2);
    expect(ctx.sessionsH.get()[0].colorIdx).toBe(0);
  });

  it("returns false + surfaces the error when the RPC fails (no partial state)", async () => {
    const ctx = seed();
    mock.enqueue("rpc:create_patient_with_sessions", { data: null, error: { message: "boom" } });
    const ok = await ctx.actions.createPatient({ name: "Caro", ...recurringArgs });
    expect(ok).toBe(false);
    expect(ctx.error.get()).toBe("boom");
    expect(ctx.patientsH.get()).toHaveLength(0);
    expect(ctx.sessionsH.get()).toHaveLength(0);
  });
});
