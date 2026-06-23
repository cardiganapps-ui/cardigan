/**
 * @vitest-environment happy-dom
 *
 * useGroupsEnabled — the per-user, localStorage-persisted Groups toggle
 * extracted from AppShell. Pins the default-ON read, the persisted-off
 * read, the write-through setter, and the re-read on user switch.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useGroupsEnabled } from "../useGroupsEnabled";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("useGroupsEnabled", () => {
  it("defaults to ON when nothing is persisted", () => {
    const { result } = renderHook(() => useGroupsEnabled("u1"));
    expect(result.current.groupsEnabled).toBe(true);
  });

  it("reads a persisted OFF value for the user", () => {
    localStorage.setItem("cardigan.groupsEnabled.u1", "false");
    const { result } = renderHook(() => useGroupsEnabled("u1"));
    expect(result.current.groupsEnabled).toBe(false);
  });

  it("setGroupsEnabled writes through to the per-user key", () => {
    const { result } = renderHook(() => useGroupsEnabled("u1"));
    act(() => result.current.setGroupsEnabled(false));
    expect(result.current.groupsEnabled).toBe(false);
    expect(localStorage.getItem("cardigan.groupsEnabled.u1")).toBe("false");
  });

  it("re-reads when the user id changes", () => {
    localStorage.setItem("cardigan.groupsEnabled.u2", "false");
    const { result, rerender } = renderHook(({ id }) => useGroupsEnabled(id), { initialProps: { id: "u1" } });
    expect(result.current.groupsEnabled).toBe(true); // u1 has nothing → ON
    rerender({ id: "u2" });
    expect(result.current.groupsEnabled).toBe(false); // u2 persisted OFF
  });

  it("falls back to ON with no user id", () => {
    const { result } = renderHook(() => useGroupsEnabled(null));
    expect(result.current.groupsEnabled).toBe(true);
  });
});
