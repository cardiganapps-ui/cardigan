/**
 * Money input with a leading "$" adornment and live thousands-separator
 * formatting.
 *
 * Why not `type="number"`: browsers spec that out as a raw scalar — no
 * locale formatting in the visible value, so `1150` renders as "1150"
 * instead of "1,150". We use `type="text"` + `inputMode="numeric"` so
 * the iOS number keypad still opens, format on display, and strip
 * non-digit characters on the way back out. Callers keep receiving a
 * digit-only string via onChange so `Number(value)` just works — no
 * caller needed to change.
 *
 * Props:
 *   value      — current value (string; digits only)
 *   onChange   — fires with a synthetic event; event.target.value is
 *                the digit-only string
 *   placeholder, disabled, autoFocus, required — pass-through
 *   Any additional props are forwarded to the underlying input, EXCEPT
 *   `type`, `min`, `max`, `step` — those are no-ops on a text input and
 *   would produce DOM warnings, so we drop them here.
 */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  inputMode = "numeric",
  required,
  ...rest
}) {
  // Silently drop attrs that would be ignored / warn on type=text. Keeps
  // every existing caller working (they pass min/step/max freely).
  const {
    type: _type,
    min: _min,
    max: _max,
    step: _step,
    ...restSafe
  } = rest;

  const display = formatMoneyInput(value);

  const handleChange = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    // Synthesize an event whose target.value is the cleaned string so
    // listeners don't have to do their own parsing.
    onChange({ ...e, target: { ...e.target, value: raw } });
  };

  return (
    <div className="money-input-wrap">
      <span className="money-input-symbol" aria-hidden="true">$</span>
      <input
        type="text"
        className="input money-input"
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        inputMode={inputMode}
        required={required}
        autoComplete="off"
        {...restSafe}
      />
    </div>
  );
}

function formatMoneyInput(value) {
  if (value === "" || value == null) return "";
  const digits = String(value).replace(/[^\d]/g, "");
  if (digits === "") return "";
  // en-US locale gives "1,150" — Cardigan displays amounts elsewhere
  // with `.toLocaleString()` (default locale = en-US on web), so the
  // input and the read-only displays stay consistent.
  return Number(digits).toLocaleString("en-US");
}
