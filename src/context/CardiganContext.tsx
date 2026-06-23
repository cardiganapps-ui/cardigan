import { createContext, useContext, useMemo, type ReactNode } from "react";

/* The shape injected by useCardiganData + AppShell. It carries ~70 keys
   (data arrays, mutation actions, UI/navigation state). Typed as a
   permissive bridge during the TS migration so .ts/.tsx consumers can
   destructure it without `any` casts at every call site; tighten this into
   a precise interface once useCardiganData itself is migrated (Tier 2/3). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional migration bridge; tighten when useCardiganData is typed
export type CardiganContextValue = Record<string, any>;

/* ── Sliced context (WS-2) ────────────────────────────────────────────
   The single 70-key context value used to recompute (and re-render all
   ~107 consumers) on every navigation, because the fast-changing UI
   state (screen / drawerOpen / pendingFabAction / tutorial / theme /
   notifications) lived in the same memoized object as the data arrays +
   stable callbacks.

   It's now split across two contexts:
     • MainContext — data arrays, mutation actions, the stable cross-
       cutting callbacks, config (readOnly / subscription / profession).
       Its value is referentially STABLE across navigation, so a consumer
       reading only `useCardiganMain()` no longer re-renders when the user
       navigates or toggles the drawer.
     • UIContext — the fast-changing navigation / UI state + the nav
       actions that pair with it.

   `useCardigan()` stays as a back-compat hook that merges both, so all
   existing consumers keep working unchanged; screens migrate to the
   granular hooks (`useCardiganMain` / `useCardiganUI`) one at a time to
   claim the re-render win. */
const MainContext = createContext<CardiganContextValue | null>(null);
const UIContext = createContext<CardiganContextValue | null>(null);

/* The provider is dual-mode for a clean, no-big-bang migration:
   • Pass split `mainValue` + `uiValue` (the therapist AppShell) to get
     the granular re-render behavior.
   • Pass a single flat `value` (the patient portal + the test harness) to
     feed the SAME bag to both contexts — back-compat, no key partition
     required. */
export function CardiganProvider({
  value, mainValue, uiValue, children,
}: {
  value?: CardiganContextValue;
  mainValue?: CardiganContextValue;
  uiValue?: CardiganContextValue;
  children: ReactNode;
}) {
  const main = mainValue ?? value ?? null;
  const ui = uiValue ?? value ?? null;
  return (
    <MainContext.Provider value={main}>
      <UIContext.Provider value={ui}>{children}</UIContext.Provider>
    </MainContext.Provider>
  );
}

// Colocating the Providers + consumer hooks in one file is the standard
// React context pattern; splitting just to satisfy fast-refresh would
// fragment the importers.
/* eslint-disable react-refresh/only-export-components */

/** Data arrays, mutation actions, stable callbacks, config. Referentially
    stable across navigation — prefer this in data-display screens. */
export function useCardiganMain(): CardiganContextValue {
  const ctx = useContext(MainContext);
  if (!ctx) throw new Error("useCardiganMain must be used within CardiganProvider");
  return ctx;
}

/** Fast-changing navigation / UI state (screen, drawerOpen, …) + the nav
    actions. Re-renders on navigation — use only where that's expected. */
export function useCardiganUI(): CardiganContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useCardiganUI must be used within CardiganProvider");
  return ctx;
}

/** Back-compat: the full merged bag (main + ui). Existing consumers keep
    using this; it re-renders on any change in either slice. Migrate to
    useCardiganMain / useCardiganUI to claim the granular re-render win. */
export function useCardigan(): CardiganContextValue {
  const main = useCardiganMain();
  const ui = useCardiganUI();
  return useMemo(() => ({ ...main, ...ui }), [main, ui]);
}
/* eslint-enable react-refresh/only-export-components */
