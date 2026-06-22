import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import type { CSSProperties, HTMLAttributes } from "react";

/* ── AnimatedNumber ──
   Render a number that count-up animates on mount and on change.
   Pass `format` to control how the (possibly-fractional during-
   animation) interpolated value is stringified — defaults to
   Math.round → "1234".

   Why round-before-format: most KPI numbers are integers (session
   counts, patient counts, MXN amounts), so rendering "$1499.34"
   mid-animation looks broken. Round inside the format step instead
   of inside the hook so callers who DO want fractional in-flight
   values (rare — credit balance, etc.) can opt out by passing their
   own format.

   Wraps its children in a span with tabular-nums by default so the
   width doesn't visually "dance" as digits change. Override via the
   `style` prop if needed.

   Usage:
     <AnimatedNumber value={1234} />              // → "1234"
     <AnimatedNumber value={1234} format={formatMXN} />  // → "$1,234"
     <AnimatedNumber value={42} duration={500} />
*/
export function AnimatedNumber({ value, format, duration, enabled, style, ...rest }: {
  value: number | null | undefined;
  format?: (n: number) => string;
  duration?: number;
  enabled?: boolean;
  style?: CSSProperties;
} & HTMLAttributes<HTMLSpanElement>) {
  const animated = useAnimatedNumber(value, { duration, enabled });
  const display = typeof animated === "number" && isFinite(animated)
    ? (format ? format(Math.round(animated)) : Math.round(animated).toString())
    : (format && animated != null ? format(animated) : animated);
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }} {...rest}>{display}</span>;
}
