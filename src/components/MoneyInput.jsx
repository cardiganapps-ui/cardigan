/**
 * Money input with a leading "$" adornment.
 *
 * Wraps a standard .input so every editable money value shows the
 * currency symbol alongside the number. Accepts any standard input
 * props; renders a number input by default.
 */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  min = 0,
  step = 1,
  disabled,
  autoFocus,
  inputMode = "decimal",
  ...rest
}) {
  return (
    <div className="money-input-wrap">
      <span className="money-input-symbol" aria-hidden="true">$</span>
      <input
        type="number"
        className="input money-input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        min={min}
        step={step}
        disabled={disabled}
        autoFocus={autoFocus}
        inputMode={inputMode}
        {...rest}
      />
    </div>
  );
}
