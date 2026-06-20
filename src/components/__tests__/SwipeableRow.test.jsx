/**
 * @vitest-environment happy-dom
 *
 * SwipeableRow exposes a destructive action behind a left-swipe on touch,
 * but the action MUST also be reachable without gestures — keyboard and
 * screen-reader users can't swipe. These tests lock in that accessibility
 * contract: the children render, the action <button> exists with the
 * given aria-label, it is focusable, and activating it (click) fires
 * onAction. The swipe physics themselves are touch-only and not asserted
 * here (happy-dom has no real touch/layout); the focus + click path is
 * the part that actually guarantees the row stays operable for everyone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

beforeEach(() => {
  // SwipeableRow's discoverability "peek" uses rAF + timers and reads
  // localStorage; keep them harmless and deterministic. getBoundingClientRect
  // is stubbed via happy-dom defaults (returns zeros), which is fine.
  vi.stubGlobal("requestAnimationFrame", (cb) => { cb(0); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  try { localStorage.setItem("cardigan.swipe.hint.shown", "1"); } catch { /* ignore */ }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

import { SwipeableRow } from "../SwipeableRow";

function renderRow(props = {}) {
  return render(
    <SwipeableRow onAction={() => {}} actionLabel="Eliminar" {...props}>
      <div className="row-item">Pago · $500</div>
    </SwipeableRow>,
  );
}

describe("SwipeableRow", () => {
  it("renders its children", () => {
    const { getByText } = renderRow();
    expect(getByText("Pago · $500")).toBeTruthy();
  });

  it("renders the action button with the given aria-label", () => {
    const { getByRole } = renderRow({ actionLabel: "Eliminar" });
    const btn = getByRole("button", { name: "Eliminar" });
    expect(btn).toBeTruthy();
    // The visible label text is also present inside the button.
    expect(btn.textContent).toContain("Eliminar");
  });

  it("the action button is a real, focusable <button> (keyboard reachable)", () => {
    const { getByRole } = renderRow();
    const btn = getByRole("button", { name: "Eliminar" });
    expect(btn.tagName).toBe("BUTTON");
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it("fires onAction when the action button is activated (no swipe needed)", () => {
    const onAction = vi.fn();
    // exitOnAction: false skips the height-collapse exit animation, so
    // onAction fires synchronously on click — the path we want to assert.
    const { getByRole } = renderRow({ onAction, exitOnAction: false });
    fireEvent.click(getByRole("button", { name: "Eliminar" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("uses the provided actionLabel verbatim for the aria-label", () => {
    const { getByRole } = renderRow({ actionLabel: "Quitar pago" });
    expect(getByRole("button", { name: "Quitar pago" })).toBeTruthy();
  });
});
