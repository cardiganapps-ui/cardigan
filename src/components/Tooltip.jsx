import { useState, useRef, useEffect, cloneElement, isValidElement } from "react";

const SHOW_DELAY = 500;
const HIDE_DELAY = 80;

export default function Tooltip({ label, children, placement = "bottom", shortcut }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);
  const showTimer = useRef(null);
  const hideTimer = useRef(null);

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

  const anchor = cloneElement(children, {
    ref: (node) => {
      anchorRef.current = node;
      const { ref } = children;
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") ref.current = node;
    },
    onMouseEnter: (e) => { children.props.onMouseEnter?.(e); show(); },
    onMouseLeave: (e) => { children.props.onMouseLeave?.(e); hide(); },
    onFocus: (e) => { children.props.onFocus?.(e); show(); },
    onBlur: (e) => { children.props.onBlur?.(e); hide(); },
    onClick: (e) => { children.props.onClick?.(e); hide(); },
  });

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
