/**
 * @vitest-environment happy-dom
 *
 * Shared pill segmented control — high fan-out (period filters, tab
 * switchers across the app). Locks in the contract: one button per item,
 * the active item is reflected via aria-selected + the `active` class,
 * and clicking a button fires onChange with that item's key.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { SegmentedControl } from "../SegmentedControl";

afterEach(cleanup);

const ITEMS = [
  { k: "all", l: "Todo" },
  { k: "1m", l: "1 mes" },
  { k: "3m", l: "3 meses" },
];

function renderControl(props = {}) {
  return render(
    <SegmentedControl items={ITEMS} value="all" onChange={() => {}} {...props} />,
  );
}

describe("SegmentedControl", () => {
  it("renders one button per item with its label", () => {
    const { getByText, container } = renderControl();
    expect(container.querySelectorAll(".segmented-btn").length).toBe(ITEMS.length);
    ITEMS.forEach((it) => expect(getByText(it.l)).toBeTruthy());
  });

  it("reflects the active item via aria-selected and the active class", () => {
    const { getByText } = renderControl({ value: "1m" });
    const activeBtn = getByText("1 mes");
    const inactiveBtn = getByText("Todo");
    expect(activeBtn.getAttribute("aria-selected")).toBe("true");
    expect(activeBtn.className).toContain("active");
    expect(inactiveBtn.getAttribute("aria-selected")).toBe("false");
    expect(inactiveBtn.className).not.toContain("active");
  });

  it("default role is tablist with tab children", () => {
    const { container, getByText } = renderControl();
    expect(container.querySelector('[role="tablist"]')).toBeTruthy();
    expect(getByText("Todo").getAttribute("role")).toBe("tab");
  });

  it("calls onChange with the clicked item's key", () => {
    const onChange = vi.fn();
    const { getByText } = renderControl({ onChange });
    fireEvent.click(getByText("3 meses"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("3m");
  });

  it("passes through ariaLabel onto the container", () => {
    const { container } = renderControl({ ariaLabel: "Período" });
    expect(container.querySelector('[aria-label="Período"]')).toBeTruthy();
  });
});
