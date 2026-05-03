import { useEffect, useRef, useState } from "react";
import { statusClass, statusLabel } from "../utils/sessions";

/* Render a session-status pill with optional "just changed" pulse.
   The pulse is keyed on the `status` prop — when it changes between
   renders (and the badge has already been mounted with a previous
   value), we mark the pill as `.is-pulsing` for the animation
   duration. Mount-time renders don't pulse so the initial paint of
   a long list isn't a confetti of pulses. */
export function StatusBadge({ status, style }) {
  const prevStatus = useRef(status);
  const mounted = useRef(false);
  const [pulse, setPulse] = useState(false);

  // setState in this effect is the trigger for a one-shot animation
  // (timer-driven). Suppressing the eslint rule per the same
  // convention as ConfirmDialog / UpdatePrompt — the rule guards
  // against accidental cascades, not deliberate animation kicks.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prevStatus.current = status;
      return;
    }
    if (prevStatus.current !== status) {
      prevStatus.current = status;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPulse(true);
      const id = setTimeout(() => setPulse(false), 950);
      return () => clearTimeout(id);
    }
  }, [status]);

  const cls = `session-status ${statusClass(status)}${pulse ? " is-pulsing" : ""}`;
  return (
    <span className={cls} style={style}>
      {statusLabel(status)}
    </span>
  );
}
