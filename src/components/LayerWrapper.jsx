import { useLayer } from "../hooks/useLayer";

/**
 * Wraps a modal/overlay to register with the navigation layer stack.
 * Render this component conditionally: {isOpen && <LayerWrapper ...>}
 * It will push a history entry on mount and pop on unmount.
 */
export function LayerWrapper({ layerKey, onClose, children }) {
  useLayer(layerKey, onClose);
  return children;
}
