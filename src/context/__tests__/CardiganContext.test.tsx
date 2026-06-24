/**
 * @vitest-environment happy-dom
 *
 * Tests the WS-2 sliced context: the dual-mode provider (flat back-compat
 * `value` vs split `mainValue`/`uiValue`), the back-compat `useCardigan()`
 * merge, and — the whole point of the split — that a `useCardiganMain()`
 * consumer does NOT re-render when only the UI slice changes.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { memo, useEffect, useState } from "react";
import { CardiganProvider, useCardigan, useCardiganMain, useCardiganUI } from "../CardiganContext";
import type { CardiganContextValue, CardiganMainValue, CardiganUIValue } from "../CardiganContext";

afterEach(() => cleanup());

describe("CardiganProvider (dual-mode) + back-compat useCardigan", () => {
  it("a flat `value` feeds BOTH slices (patient portal + test harness path)", () => {
    // Minimal fake value — cast to the precise context type for the test.
    const flat = { patients: [1, 2], screen: "home" } as unknown as CardiganContextValue;
    function Probe() {
      const main = useCardiganMain();
      const ui = useCardiganUI();
      const merged = useCardigan();
      return <div data-testid="o">{`${main === flat}|${ui === flat}|${JSON.stringify(merged.patients)}`}</div>;
    }
    const { getByTestId } = render(<CardiganProvider value={flat}><Probe /></CardiganProvider>);
    expect(getByTestId("o").textContent).toBe("true|true|[1,2]");
  });

  it("split slices merge in useCardigan", () => {
    const mainValue = { patients: [1], readOnly: true };
    const uiValue = { screen: "agenda", drawerOpen: true };
    function Probe() {
      const m = useCardigan();
      return <div data-testid="o">{JSON.stringify(m)}</div>;
    }
    const { getByTestId } = render(<CardiganProvider mainValue={mainValue as unknown as CardiganMainValue} uiValue={uiValue as unknown as CardiganUIValue}><Probe /></CardiganProvider>);
    expect(JSON.parse(getByTestId("o").textContent || "{}")).toEqual({ patients: [1], readOnly: true, screen: "agenda", drawerOpen: true });
  });
});

describe("WS-2 granular re-render isolation", () => {
  it("a useCardiganMain consumer does NOT re-render when only the UI slice changes", () => {
    // Count commits via an effect (lint-clean side effect): a memo'd
    // consumer whose context didn't change is skipped, so its effect
    // doesn't re-run.
    const counts = { main: 0, ui: 0 };
    const MainConsumer = memo(function MainConsumer() {
      useCardiganMain();
      useEffect(() => { counts.main++; });
      return null;
    });
    const UIConsumer = memo(function UIConsumer() {
      useCardiganUI();
      useEffect(() => { counts.ui++; });
      return null;
    });
    function Harness() {
      // mainValue is stable across renders (held in state, never set);
      // uiValue is what we mutate to simulate a navigation.
      const [mainValue] = useState({ patients: [] as number[] });
      const [uiValue, setUiValue] = useState<Record<string, unknown>>({ screen: "home" });
      return (
        <CardiganProvider mainValue={mainValue as unknown as CardiganMainValue} uiValue={uiValue as unknown as CardiganUIValue}>
          <MainConsumer />
          <UIConsumer />
          <button data-testid="nav" onClick={() => setUiValue({ screen: "agenda" })}>nav</button>
        </CardiganProvider>
      );
    }
    const { getByTestId } = render(<Harness />);
    expect(counts.main).toBe(1);
    expect(counts.ui).toBe(1);

    // Simulate a navigation: only the UI slice's value changes.
    act(() => { getByTestId("nav").click(); });

    // The main consumer is insulated — no re-render…
    expect(counts.main).toBe(1);
    // …the UI consumer re-renders, confirming the provider did update.
    expect(counts.ui).toBe(2);
  });
});
