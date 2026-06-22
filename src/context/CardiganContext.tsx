import { createContext, useContext, type ReactNode } from "react";

/* The shape injected by useCardiganData + AppShell. It currently carries
   ~70 keys (data arrays, mutation actions, UI/navigation state). Typed as
   a permissive bridge during the TS migration so .ts/.tsx consumers can
   destructure it without `any` casts at every call site; tighten this into
   a precise interface once useCardiganData itself is migrated (Tier 2/3).
   See docs/elite-product-review plan, Phase 2/4. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional migration bridge; tighten when useCardiganData is typed
export type CardiganContextValue = Record<string, any>;

const CardiganContext = createContext<CardiganContextValue | null>(null);

export function CardiganProvider({ value, children }: { value: CardiganContextValue; children: ReactNode }) {
  return <CardiganContext.Provider value={value}>{children}</CardiganContext.Provider>;
}

// Colocating the Provider + consumer hook in one file is the standard
// React context pattern; splitting just to satisfy fast-refresh would
// fragment 19 importers.
// eslint-disable-next-line react-refresh/only-export-components
export function useCardigan(): CardiganContextValue {
  const ctx = useContext(CardiganContext);
  if (!ctx) throw new Error("useCardigan must be used within CardiganProvider");
  return ctx;
}
