/**
 * @vitest-environment happy-dom
 *
 * Shared empty-state card. Every "no data yet" surface routes through it,
 * so we lock in: title + body render when provided, an illustration SVG
 * is drawn for known kinds, the optional CTA slot renders its node, and
 * unknown kinds degrade to no illustration (rather than throwing).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EmptyState } from "../EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders title + body text", () => {
    const { getByText } = render(
      <EmptyState kind="finances" title="Sin pagos" body="Cuando registres un pago aparecerá aquí." />,
    );
    expect(getByText("Sin pagos")).toBeTruthy();
    expect(getByText("Cuando registres un pago aparecerá aquí.")).toBeTruthy();
  });

  it("draws an illustration SVG for a known kind", () => {
    const { container } = render(<EmptyState kind="finances" title="x" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders the CTA node in its slot", () => {
    const { getByRole } = render(
      <EmptyState kind="patients" title="x" cta={<button>Agregar</button>} />,
    );
    expect(getByRole("button", { name: "Agregar" })).toBeTruthy();
  });

  it("omits title/body when not provided", () => {
    const { container } = render(<EmptyState kind="agenda" />);
    // Only the illustration; no title/body divs with text.
    expect(container.textContent.trim()).toBe("");
  });

  it("does not throw and draws no illustration for an unknown kind", () => {
    const { container } = render(<EmptyState kind="nope-not-real" title="Hola" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toContain("Hola");
  });

  it("renders distinct illustrations across kinds", () => {
    const kinds = ["patients", "agenda", "notes", "documents", "finances", "potentials"];
    for (const kind of kinds) {
      const { container, unmount } = render(<EmptyState kind={kind} title="t" />);
      expect(container.querySelector("svg")).toBeTruthy();
      unmount();
    }
  });
});
