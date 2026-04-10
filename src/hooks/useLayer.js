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
  const registered = useRef(false);

  useEffect(() => {
    if (!registered.current) {
      pushLayer(key, closeFn);
      registered.current = true;
    }
    return () => {
      removeLayer(key);
      registered.current = false;
    };
  }, []); // Only on mount/unmount
}
