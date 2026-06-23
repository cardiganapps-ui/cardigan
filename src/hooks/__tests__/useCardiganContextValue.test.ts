/**
 * @vitest-environment happy-dom
 *
 * Characterization tests for the CardiganContext assembler extracted from
 * App.tsx's AppShell. Most of the assembled object is pass-through wiring;
 * these tests pin the handlers that carry real logic — the pro-gated
 * uploadDocument, the undoable-delete wrappers, onCancelSession's
 * read-only gate, and onMarkCompleted's episodic "schedule next" prompt
 * (fire / suppress matrix).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

// Deterministic date seam so the onMarkCompleted "has a future visit"
// check is testable without depending on the wall clock. row.date is
// passed through as-is (we feed ISO strings directly) and "today" is
// pinned.
vi.mock("../../utils/dates", () => ({
  shortDateToISO: (d: string) => d,
  todayISO: () => "2026-06-23",
}));

import { useCardiganContextValue } from "../useCardiganContextValue";

const t = (k: string) => k;

function baseDeps(over: Record<string, unknown> = {}) {
  return {
    data: { uploadDocument: vi.fn(async () => "doc-id"), softDeleteSession: vi.fn(), softDeletePayment: vi.fn(), softDeleteExpense: vi.fn(), softDeleteNote: vi.fn(), deleteRecurringTemplate: vi.fn() },
    readOnly: false,
    subscription: { isPro: true },
    requirePro: vi.fn(),
    withUndoableDelete: vi.fn((_fn: unknown, _label: string) => vi.fn()),
    noteCrypto: {},
    profession: "psychologist",
    accentTheme: {},
    userProfile: { setProfessionLocal: vi.fn() },
    groupsEnabled: true,
    setGroupsEnabled: vi.fn(),
    user: { id: "u1" },
    userName: "Demo",
    userInitial: "D",
    openRecordPaymentModal: vi.fn(),
    openEditPaymentModal: vi.fn(),
    openRecordExpenseModal: vi.fn(),
    openEditExpenseModal: vi.fn(),
    openRecurringExpenseSheet: vi.fn(),
    setHideFab: vi.fn(),
    setHideBottomTabs: vi.fn(),
    setScreen: vi.fn(),
    admin: true,
    navigate: vi.fn(),
    pushLayer: vi.fn(),
    popLayer: vi.fn(),
    removeLayer: vi.fn(),
    online: true,
    screen: "home",
    drawerOpen: false,
    setDrawerOpen: vi.fn(),
    tutorial: {},
    theme: {},
    notifications: {},
    showSuccess: vi.fn(),
    showToast: vi.fn(),
    pendingFabAction: null,
    setPendingFabAction: vi.fn(),
    setActivationShareOpen: vi.fn(),
    pendingAgendaViewRef: { current: null as unknown },
    pendingExpedienteRef: { current: null as unknown },
    pendingNoteOpenRef: { current: null as unknown },
    openQuickSchedule: vi.fn(),
    updateSessionStatus: vi.fn(async () => true),
    patients: [{ id: "p1", name: "Juan Pérez", scheduling_mode: "episodic" }],
    upcomingSessions: [],
    t,
    ...over,
  };
}

afterEach(() => cleanup());

describe("useCardiganContextValue", () => {
  it("overrides readOnly and surfaces isAdminUser", () => {
    const { result } = renderHook(() => useCardiganContextValue(baseDeps({ readOnly: true, admin: true })));
    expect(result.current.readOnly).toBe(true);
    expect(result.current.isAdminUser).toBe(true);
  });

  it("uploadDocument passes through for Pro users", async () => {
    const deps = baseDeps({ subscription: { isPro: true } });
    const { result } = renderHook(() => useCardiganContextValue(deps));
    const res = await result.current.uploadDocument();
    expect(res).toBe("doc-id");
    expect(deps.requirePro).not.toHaveBeenCalled();
  });

  it("uploadDocument is pro-gated to a no-op for non-Pro users", async () => {
    const deps = baseDeps({ subscription: { isPro: false } });
    const { result } = renderHook(() => useCardiganContextValue(deps));
    const res = await result.current.uploadDocument();
    expect(res).toBeNull();
    expect(deps.requirePro).toHaveBeenCalledWith("documents");
    expect(deps.data.uploadDocument).not.toHaveBeenCalled();
  });

  it("wraps the four everyday deletes in withUndoableDelete with their labels", () => {
    const deps = baseDeps();
    renderHook(() => useCardiganContextValue(deps));
    const labels = deps.withUndoableDelete.mock.calls.map((c: unknown[]) => c[1]);
    expect(labels).toEqual(["Sesión eliminada", "Pago eliminado", "Gasto eliminado", "Nota eliminada"]);
  });

  it("onCancelSession is gated by readOnly", async () => {
    const ro = baseDeps({ readOnly: true });
    const { result: r1 } = renderHook(() => useCardiganContextValue(ro));
    await r1.current.onCancelSession({ id: "s1" }, false, null);
    expect(ro.updateSessionStatus).not.toHaveBeenCalled();

    const rw = baseDeps({ readOnly: false });
    const { result: r2 } = renderHook(() => useCardiganContextValue(rw));
    await r2.current.onCancelSession({ id: "s1" }, true, "reason");
    expect(rw.updateSessionStatus).toHaveBeenCalledWith("s1", "cancelled", true, "reason");
  });

  it("onMarkCompleted fires the schedule-next prompt for an episodic patient with no future visit", async () => {
    const deps = baseDeps();
    const { result } = renderHook(() => useCardiganContextValue(deps));
    const ok = await result.current.onMarkCompleted({ id: "s1", patient_id: "p1" });
    expect(ok).toBe(true);
    expect(deps.updateSessionStatus).toHaveBeenCalledWith("s1", "completed");
    expect(deps.showToast).toHaveBeenCalledTimes(1);
    const [msg, kind, opts] = deps.showToast.mock.calls[0];
    expect(msg).toContain("Juan");
    expect(kind).toBe("success");
    expect(opts.key).toBe("end-of-visit:p1");
  });

  it("onMarkCompleted does NOT prompt for a non-episodic (recurring) patient", async () => {
    const deps = baseDeps({ patients: [{ id: "p1", name: "Juan", scheduling_mode: "recurring" }] });
    const { result } = renderHook(() => useCardiganContextValue(deps));
    await result.current.onMarkCompleted({ id: "s1", patient_id: "p1" });
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it("onMarkCompleted does NOT prompt when a future scheduled visit already exists", async () => {
    const deps = baseDeps({
      upcomingSessions: [{ id: "s2", patient_id: "p1", status: "scheduled", date: "2026-12-31" }],
    });
    const { result } = renderHook(() => useCardiganContextValue(deps));
    await result.current.onMarkCompleted({ id: "s1", patient_id: "p1" });
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it("onMarkCompleted is gated by readOnly and does not flip status", async () => {
    const deps = baseDeps({ readOnly: true });
    const { result } = renderHook(() => useCardiganContextValue(deps));
    const ok = await result.current.onMarkCompleted({ id: "s1", patient_id: "p1" });
    expect(ok).toBe(false);
    expect(deps.updateSessionStatus).not.toHaveBeenCalled();
  });

  it("onMarkCompleted with a non-completed override flips status but does not prompt", async () => {
    const deps = baseDeps();
    const { result } = renderHook(() => useCardiganContextValue(deps));
    await result.current.onMarkCompleted({ id: "s1", patient_id: "p1" }, "scheduled");
    expect(deps.updateSessionStatus).toHaveBeenCalledWith("s1", "scheduled");
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it("openExpediente stashes origin + navigates, consumeExpediente drains it", () => {
    const deps = baseDeps({ screen: "home" });
    const { result } = renderHook(() => useCardiganContextValue(deps));
    result.current.openExpediente({ id: "p1" });
    expect(deps.setScreen).toHaveBeenCalledWith("patients");
    const drained = result.current.consumeExpediente();
    expect(drained).toEqual({ patient: { id: "p1" }, origin: "home" });
    expect(result.current.consumeExpediente()).toBeNull();
  });
});
