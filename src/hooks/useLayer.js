import { useEffect, useRef } from "react";
import { useCardigan } from "../context/CardiganContext";

/**
 * Hook for modal/overlay components to register with the navigation layer stack.
 * When the component mounts, it pushes a history entry. When the user hits browser back,
 * the closeFn is called automatically.
 *
 * Usage:
 *   useLayer("expediente", onClose);
 */
export function useLayer(key, closeFn) {
  const { pushLayer, removeLayer } = useCardigan();
  // Capture the latest closeFn in a ref so the registered layer always
  // calls the current closure, without re-registering on every render.
  const closeRef = useRef(closeFn);
  useEffect(() => { closeRef.current = closeFn; }, [closeFn]);

  useEffect(() => {
    // Pass a falsy key (null/undefined/empty) to opt out — e.g. when a
    // component renders inline on desktop and shouldn't participate in the
    // back-button/ESC stack.
    if (!key) return;
    pushLayer(key, () => closeRef.current?.());
    return () => removeLayer(key);
  }, [key, pushLayer, removeLayer]);
}
