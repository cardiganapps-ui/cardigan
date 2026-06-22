import type { AriaRole, KeyboardEvent, SyntheticEvent } from "react";

/* ── Accessibility helpers ───────────────────────────────────────────
   Make a non-native interactive element (a <div>/<span> carrying an
   onClick) operable by keyboard and announced correctly to assistive
   tech — the fix for jsx-a11y/click-events-have-key-events +
   no-static-element-interactions. Native <button> is still preferred
   when layout allows; this is for the cases where a div/span is load-
   bearing for styling and can't trivially become a button.

   Spread onto the element instead of a bare onClick:

     <div {...clickableProps(handler)}>…</div>

   Enter and Space fire the handler (matching native button semantics)
   and Space's default page-scroll is suppressed. `disabled` removes the
   element from the tab order and drops the handlers. */

export interface ClickablePropsOptions {
  /** ARIA role to expose. Defaults to "button". Use "link" for nav. */
  role?: AriaRole;
  /** When true, the element is non-interactive and not focusable. */
  disabled?: boolean;
  /** Accessible name when the element has no readable text content. */
  label?: string;
}

export function clickableProps(
  onClick: (e?: SyntheticEvent) => void,
  { role = "button", disabled = false, label }: ClickablePropsOptions = {},
) {
  if (disabled) {
    return { role, "aria-disabled": true, "aria-label": label } as const;
  }
  return {
    role,
    tabIndex: 0,
    "aria-label": label,
    onClick,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick(e);
      }
    },
  };
}
