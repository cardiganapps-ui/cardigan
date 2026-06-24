import type { ReactNode, HTMLAttributes } from "react";

/* ── SheetOverlay ─────────────────────────────────────────────────────
   The dimmed backdrop behind every bottom sheet / modal. Formalizes the
   pattern the whole app hand-rolled as
     <div className="sheet-overlay" onClick={close}>
       <div className="sheet-panel" onClick={e => e.stopPropagation()}>…</div>
     </div>
   into one component so the backdrop's click-to-dismiss + the a11y
   treatment live in a single reviewed place.

   Click-to-dismiss is a mouse convenience; keyboard users dismiss via
   Escape (useEscape) and the focus-trapped close button, so the
   click-events-have-key-events / no-static-element-interactions rules are
   disabled here ONCE rather than at ~60 call sites. The target check (only
   fire when the click landed on the backdrop itself, not bubbled up from
   the panel) replaces the panel's stopPropagation — so panels no longer
   need an onClick of their own.

   `onClose` is passed already-gated by the caller (e.g. `submitting ?
   undefined : animatedClose`); a null/undefined value makes the backdrop
   inert, preserving the "can't dismiss mid-submit" behavior. */

interface SheetOverlayProps extends Omit<HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** Close handler; pass undefined/null to make the backdrop inert. */
  onClose?: (() => void) | null;
  /** Adds the sheet-overlay--exit class for the close animation. */
  exiting?: boolean;
  /** Extra classes appended after `sheet-overlay`. */
  className?: string;
  children: ReactNode;
}

export function SheetOverlay({ onClose, exiting, className, children, ...rest }: SheetOverlayProps) {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop click-to-dismiss is a mouse convenience; keyboard dismissal is Escape + the focus-trapped close button (see header)
    <div
      className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}${className ? ` ${className}` : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      {...rest}
    >
      {children}
    </div>
  );
}
