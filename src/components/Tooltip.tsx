import { useState, useRef, useEffect, cloneElement, isValidElement } from "react";

const SHOW_DELAY = 500;
const HIDE_DELAY = 80;

export default function Tooltip({ label, children, placement = "bottom", shortcut }: {
  label?: React.ReactNode;
  children: React.ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  shortcut?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLElement | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
  }, []);

  const measure = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const GAP = 8;
    let top, left;
    if (placement === "top") {
      top = r.top - GAP;
      left = r.left + r.width / 2;
    } else if (placement === "left") {
      top = r.top + r.height / 2;
      left = r.left - GAP;
    } else if (placement === "right") {
      top = r.top + r.height / 2;
      left = r.right + GAP;
    } else {
      top = r.bottom + GAP;
      left = r.left + r.width / 2;
    }
    setCoords({ top, left });
  };

  const show = () => {
    clearTimeout(hideTimer.current);
    if (visible) return;
    showTimer.current = setTimeout(() => {
      measure();
      setVisible(true);
    }, SHOW_DELAY);
  };
  const hide = () => {
    clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_DELAY);
  };

  if (!label || !isValidElement(children)) return children || null;

  const childProps = children.props as {
    onMouseEnter?: (e: React.SyntheticEvent) => void;
    onMouseLeave?: (e: React.SyntheticEvent) => void;
    onFocus?: (e: React.SyntheticEvent) => void;
    onBlur?: (e: React.SyntheticEvent) => void;
    onClick?: (e: React.SyntheticEvent) => void;
  };
  const childRef = (children as { ref?: React.Ref<HTMLElement> }).ref;
  const anchor = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      if (typeof childRef === "function") childRef(node);
      // A ref object's `.current` is explicitly mutable by the React
      // API contract (that's how refs work). The Compiler's immutability
      // rule doesn't have a carve-out for ref-merging patterns.
      // eslint-disable-next-line react-hooks/immutability
      else if (childRef && typeof childRef === "object") (childRef as React.RefObject<HTMLElement | null>).current = node;
    },
    onMouseEnter: (e: React.SyntheticEvent) => { childProps.onMouseEnter?.(e); show(); },
    onMouseLeave: (e: React.SyntheticEvent) => { childProps.onMouseLeave?.(e); hide(); },
    onFocus: (e: React.SyntheticEvent) => { childProps.onFocus?.(e); show(); },
    onBlur: (e: React.SyntheticEvent) => { childProps.onBlur?.(e); hide(); },
    onClick: (e: React.SyntheticEvent) => { childProps.onClick?.(e); hide(); },
  } as React.Attributes);

  return (
    <>
      {anchor}
      {visible && (
        <div className={`tooltip tooltip--${placement}`} role="tooltip" style={{ top: coords.top, left: coords.left }}>
          <span>{label}</span>
          {shortcut && <kbd className="tooltip-kbd">{shortcut}</kbd>}
        </div>
      )}
    </>
  );
}
