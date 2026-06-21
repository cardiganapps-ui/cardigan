import { describe, it, expect, vi } from "vitest";
import { clickableProps } from "../a11y";

describe("clickableProps", () => {
  it("exposes button role + focusability by default", () => {
    const p = clickableProps(() => {});
    expect(p.role).toBe("button");
    expect(p.tabIndex).toBe(0);
    expect(typeof p.onClick).toBe("function");
    expect(typeof p.onKeyDown).toBe("function");
  });

  it("fires the handler on Enter and Space, and prevents default", () => {
    const onClick = vi.fn();
    const p = clickableProps(onClick);
    for (const key of ["Enter", " "]) {
      const e = { key, preventDefault: vi.fn() };
      p.onKeyDown(e);
      expect(e.preventDefault).toHaveBeenCalledOnce();
    }
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("ignores other keys", () => {
    const onClick = vi.fn();
    const p = clickableProps(onClick);
    const e = { key: "a", preventDefault: vi.fn() };
    p.onKeyDown(e);
    expect(onClick).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("honors a custom role and accessible label", () => {
    const p = clickableProps(() => {}, { role: "link", label: "Abrir" });
    expect(p.role).toBe("link");
    expect(p["aria-label"]).toBe("Abrir");
  });

  it("when disabled: not focusable, aria-disabled, no handlers", () => {
    const onClick = vi.fn();
    const p = clickableProps(onClick, { disabled: true });
    expect(p["aria-disabled"]).toBe(true);
    expect(p.tabIndex).toBeUndefined();
    expect(p.onClick).toBeUndefined();
    expect(p.onKeyDown).toBeUndefined();
  });
});
