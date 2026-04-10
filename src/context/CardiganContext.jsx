import { createContext, useContext } from "react";

const CardiganContext = createContext(null);

export function CardiganProvider({ value, children }) {
  return <CardiganContext.Provider value={value}>{children}</CardiganContext.Provider>;
}

export function useCardigan() {
  const ctx = useContext(CardiganContext);
  if (!ctx) throw new Error("useCardigan must be used within CardiganProvider");
  return ctx;
}
