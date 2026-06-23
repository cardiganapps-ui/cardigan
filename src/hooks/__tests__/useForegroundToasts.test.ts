/**
 * @vitest-environment happy-dom
 *
 * useForegroundToasts — the post-SW-reload confirmation + native
 * foreground-push toast effects extracted from AppShell. Pins that a
 * pending post-update stamp surfaces via showSuccess on mount, and that a
 * cardigan-native-push-received event surfaces its body via showToast.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";

const consumePostUpdateToast = vi.fn();
vi.mock("../../components/UpdatePrompt", () => ({ consumePostUpdateToast: () => consumePostUpdateToast() }));

import { useForegroundToasts } from "../useForegroundToasts";

afterEach(() => { cleanup(); consumePostUpdateToast.mockReset(); });

describe("useForegroundToasts", () => {
  it("surfaces a pending post-update toast via showSuccess on mount", () => {
    consumePostUpdateToast.mockReturnValue("Actualizado correctamente");
    const showSuccess = vi.fn();
    renderHook(() => useForegroundToasts({ showSuccess, showToast: vi.fn() }));
    expect(showSuccess).toHaveBeenCalledWith("Actualizado correctamente");
  });

  it("no post-update toast on an organic reload (null stamp)", () => {
    consumePostUpdateToast.mockReturnValue(null);
    const showSuccess = vi.fn();
    renderHook(() => useForegroundToasts({ showSuccess, showToast: vi.fn() }));
    expect(showSuccess).not.toHaveBeenCalled();
  });

  it("surfaces a native foreground push via showToast", () => {
    consumePostUpdateToast.mockReturnValue(null);
    const showToast = vi.fn();
    renderHook(() => useForegroundToasts({ showSuccess: vi.fn(), showToast }));
    act(() => {
      window.dispatchEvent(new CustomEvent("cardigan-native-push-received", { detail: { body: "Sesión en 30 min" } }));
    });
    expect(showToast).toHaveBeenCalledWith("Sesión en 30 min", "info");
  });

  it("falls back to a default body when the push payload is empty", () => {
    consumePostUpdateToast.mockReturnValue(null);
    const showToast = vi.fn();
    renderHook(() => useForegroundToasts({ showSuccess: vi.fn(), showToast }));
    act(() => {
      window.dispatchEvent(new CustomEvent("cardigan-native-push-received", { detail: {} }));
    });
    expect(showToast).toHaveBeenCalledWith("Recordatorio", "info");
  });

  it("removes the push listener on unmount", () => {
    consumePostUpdateToast.mockReturnValue(null);
    const showToast = vi.fn();
    const { unmount } = renderHook(() => useForegroundToasts({ showSuccess: vi.fn(), showToast }));
    unmount();
    act(() => {
      window.dispatchEvent(new CustomEvent("cardigan-native-push-received", { detail: { body: "x" } }));
    });
    expect(showToast).not.toHaveBeenCalled();
  });
});
