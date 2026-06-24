import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import type { ReactNode } from "react";

const MARGIN = 8;

interface MenuItem {
  key?: string;
  label?: ReactNode;
  icon?: ReactNode;
  shortcut?: ReactNode;
  divider?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export default function ContextMenu({ open, x, y, onClose, items }: { open?: boolean; x: number; y: number; onClose: () => void; items: MenuItem[] }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEscape(open ? onClose : null);

  // Measure-and-clamp happens synchronously after mount via layout
  // effect, writing directly to the element's style. Avoids the
  // second-render setState cascade you'd get from `setPos` state;
  // the initial inline style places the panel at (x, y) and the
  // clamped position overwrites it before paint.
  useLayoutEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let top = y;
    let left = x;
    if (left + r.width + MARGIN > window.innerWidth) left = window.innerWidth - r.width - MARGIN;
    if (top + r.height + MARGIN > window.innerHeight) top = window.innerHeight - r.height - MARGIN;
    if (left < MARGIN) left = MARGIN;
    if (top < MARGIN) top = MARGIN;
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [open, x, y]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("contextmenu", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("contextmenu", onDocClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="menu"
      tabIndex={-1}
      className="context-menu"
      style={{ top: y, left: x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.divider) return <div key={`d${i}`} className="context-menu-divider" />;
        return (
          <button
            key={item.key || i}
            type="button"
            role="menuitem"
            className={`context-menu-item ${item.destructive ? "context-menu-item--destructive" : ""}`}
            onClick={() => { item.onSelect?.(); onClose(); }}
            disabled={item.disabled}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Hook colocated with the component that owns the primitive it
// controls; splitting would just fragment the module.
// eslint-disable-next-line react-refresh/only-export-components
export function useContextMenu() {
  const [state, setState] = useState<{ open: boolean; x: number; y: number; items: MenuItem[] }>({ open: false, x: 0, y: 0, items: [] });
  const openAt = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    setState({ open: true, x: e.clientX, y: e.clientY, items });
  };
  const close = () => setState((s) => ({ ...s, open: false }));
  return { state, openAt, close };
}
