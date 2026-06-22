import { useLayer } from "../hooks/useLayer";
import type { ReactNode } from "react";

/**
 * Wraps a modal/overlay to register with the navigation layer stack.
 * Render this component conditionally: {isOpen && <LayerWrapper ...>}
 * It will push a history entry on mount and pop on unmount.
 */
export function LayerWrapper({ layerKey, onClose, children }: { layerKey: string; onClose: () => void; children: ReactNode }) {
  useLayer(layerKey, onClose);
  return children;
}
