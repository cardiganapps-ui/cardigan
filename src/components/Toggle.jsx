export function Toggle({ on, onToggle, pending = false, type, ariaLabel }) {
  const disabled = pending;
  return (
    <button
      type={type || "button"}
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      aria-pressed={on}
      aria-label={ariaLabel}
      style={{
        width: 44, height: 26, minHeight: 26, borderRadius: 13, border: "none",
        cursor: disabled ? "default" : "pointer",
        padding: 3,
        background: on ? "var(--teal)" : "var(--charcoal-xl)",
        transition: "background 0.4s",
        position: "relative", flexShrink: 0,
        opacity: disabled ? 0.75 : 1,
      }}>
      <div style={{
        width: 20, height: 20, borderRadius: "50%",
        background: "var(--white)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        transform: on ? "translateX(18px)" : "translateX(0)",
        transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {pending && (
          <span
            aria-hidden="true"
            style={{
              width: 10, height: 10, borderRadius: "50%",
              border: "2px solid rgba(0,0,0,0.18)",
              borderTopColor: on ? "var(--teal-dark, #1a7870)" : "var(--charcoal-md, #555)",
              animation: "togglePendingSpin 0.7s linear infinite",
              boxSizing: "border-box",
            }}
          />
        )}
      </div>
    </button>
  );
}
