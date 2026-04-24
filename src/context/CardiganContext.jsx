import { createContext, useContext } from "react";

const CardiganContext = createContext(null);

export function CardiganProvider({ value, children }) {
  return <CardiganContext.Provider value={value}>{children}</CardiganContext.Provider>;
}

// Colocating the Provider + consumer hook in one file is the standard
// React context pattern; splitting just to satisfy fast-refresh would
// fragment 19 importers.
// eslint-disable-next-line react-refresh/only-export-components
export function useCardigan() {
  const ctx = useContext(CardiganContext);
  if (!ctx) throw new Error("useCardigan must be used within CardiganProvider");
  return ctx;
}
