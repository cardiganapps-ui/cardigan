/**
 * @vitest-environment happy-dom
 *
 * usePatientEditForm — the patient edit-form state + save orchestration.
 * The patient edit/save flow is a money-write path (rate, opening balance,
 * session regeneration via applyScheduleChange) with NO e2e coverage, so
 * the branch SELECTION is pinned here: which mutation runs, with which
 * payload, under each form condition. The payload body itself is covered by
 * buildPatientEditPayload.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePatientEditForm } from "../usePatientEditForm";

const activePatient = {
  id: "p1",
  name: "Ana López",
  parent: "",
  rate: 800,
  opening_balance: 0,
  phone: "5512345678",
  email: "ana@example.com",
  birthdate: "",
  start_date: "",
  status: "active",
  whatsapp_enabled: false,
  whatsapp_consent_at: null,
  day: "Lunes",
  time: "16:00",
};

function makeDeps(over = {}) {
  return {
    selected: activePatient,
    upcomingSessions: [],
    updatePatient: vi.fn().mockResolvedValue(true),
    finalizePatient: vi.fn().mockResolvedValue(true),
    applyScheduleChange: vi.fn().mockResolvedValue(true),
    setSelected: vi.fn(),
    setEditing: vi.fn(),
    setConfirmDelete: vi.fn(),
    ...over,
  };
}

describe("usePatientEditForm — populate", () => {
  it("openEditForPatient seeds the form + opens the sheet in edit mode", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => usePatientEditForm(deps));

    act(() => result.current.openEditForPatient({ ...activePatient, opening_balance: -500, parent: "Mamá" }));

    expect(result.current.editName).toBe("Ana López");
    expect(result.current.editRate).toBe("800");
    expect(result.current.editStatus).toBe("active");
    // negative opening_balance → credit direction, positive amount field
    expect(result.current.editOpeningAmount).toBe("500");
    expect(result.current.editOpeningDir).toBe("credit");
    // parent present → minor
    expect(result.current.editIsMinor).toBe(true);
    expect(deps.setSelected).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    expect(deps.setEditing).toHaveBeenCalledWith(true);
    expect(deps.setConfirmDelete).toHaveBeenCalledWith(false);
  });

  it("opts.confirmDelete opens straight into the delete-confirm mode", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => usePatientEditForm(deps));
    act(() => result.current.openEditForPatient(activePatient, { confirmDelete: true }));
    expect(deps.setConfirmDelete).toHaveBeenCalledWith(true);
  });
});

describe("usePatientEditForm — saveEdit branch selection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("basic-info only → updatePatient with status+rate; no schedule/finalize", async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => usePatientEditForm(deps));
    act(() => result.current.openEditForPatient(activePatient));

    await act(async () => { await result.current.saveEdit(); });

    expect(deps.finalizePatient).not.toHaveBeenCalled();
    expect(deps.applyScheduleChange).not.toHaveBeenCalled();
    expect(deps.updatePatient).toHaveBeenCalledTimes(1);
    const [, payload] = deps.updatePatient.mock.calls[0];
    expect(payload).toMatchObject({ status: "active", rate: 800 });
    // sheet closes on success
    expect(deps.setSelected).toHaveBeenLastCalledWith(null);
    expect(deps.setEditing).toHaveBeenLastCalledWith(false);
  });

  it("rate changed → applyScheduleChange + updatePatient with status (rate applied via schedule)", async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => usePatientEditForm(deps));
    act(() => result.current.openEditForPatient(activePatient));
    act(() => result.current.setEditRate("950"));

    await act(async () => { await result.current.saveEdit(); });

    expect(deps.applyScheduleChange).toHaveBeenCalledTimes(1);
    const [, schedOpts] = deps.applyScheduleChange.mock.calls[0];
    expect(schedOpts).toMatchObject({ rate: 950, effectiveDate: expect.any(String) });
    expect(deps.updatePatient).toHaveBeenCalledTimes(1);
    const [, payload] = deps.updatePatient.mock.calls[0];
    expect(payload.status).toBe("active");
    expect("rate" in payload).toBe(false); // rate omitted on the schedule path
  });

  it("finalizing (active → ended) → finalizePatient + updatePatient with no status/rate", async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => usePatientEditForm(deps));
    act(() => result.current.openEditForPatient(activePatient));
    act(() => result.current.setEditStatus("ended")); // selected.status is 'active'
    expect(result.current.isFinalizingPatient).toBe(true);

    await act(async () => { await result.current.saveEdit(); });

    expect(deps.finalizePatient).toHaveBeenCalledWith("p1", expect.any(String));
    expect(deps.applyScheduleChange).not.toHaveBeenCalled();
    expect(deps.updatePatient).toHaveBeenCalledTimes(1);
    const [, payload] = deps.updatePatient.mock.calls[0];
    expect("status" in payload).toBe(false);
    expect("rate" in payload).toBe(false);
  });

  it("episodic patient skips applyScheduleChange even when rate changes", async () => {
    // scheduling_mode='episodic' → no perpetual slot. Rate change must NOT
    // route through the schedule path (would flip them onto a recurring slot).
    const episodic = { ...activePatient, scheduling_mode: "episodic", day: null, time: null };
    const deps = makeDeps({ selected: episodic });
    const { result } = renderHook(() => usePatientEditForm(deps));
    act(() => result.current.openEditForPatient(episodic));
    act(() => result.current.setEditRate("999"));

    await act(async () => { await result.current.saveEdit(); });

    expect(deps.applyScheduleChange).not.toHaveBeenCalled();
    expect(deps.updatePatient).toHaveBeenCalledTimes(1);
    const [, payload] = deps.updatePatient.mock.calls[0];
    expect(payload.rate).toBe(999); // applied via basic-info branch instead
  });

  it("does NOT close the sheet when the mutation fails", async () => {
    const deps = makeDeps({ updatePatient: vi.fn().mockResolvedValue(false) });
    const { result } = renderHook(() => usePatientEditForm(deps));
    act(() => result.current.openEditForPatient(activePatient));

    await act(async () => { await result.current.saveEdit(); });

    expect(deps.updatePatient).toHaveBeenCalledTimes(1);
    // setSelected(null)/setEditing(false) only run on success — they were
    // called during populate, but never with the closing values here.
    expect(deps.setSelected).not.toHaveBeenCalledWith(null);
    expect(deps.setEditing).not.toHaveBeenCalledWith(false);
  });

  it("no-ops when there is no selected patient", async () => {
    const deps = makeDeps({ selected: null });
    const { result } = renderHook(() => usePatientEditForm(deps));
    await act(async () => { await result.current.saveEdit(); });
    expect(deps.updatePatient).not.toHaveBeenCalled();
    expect(deps.finalizePatient).not.toHaveBeenCalled();
    expect(deps.applyScheduleChange).not.toHaveBeenCalled();
  });
});
