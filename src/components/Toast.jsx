import { useState, useEffect } from "react";
import { useT } from "../i18n/index";
import { IconCheck, IconX } from "./Icons";

/* Inline alert glyph for warning + error toasts. Stroke-2 to match
   the rest of the icon family. */
function GlyphAlert({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 9v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

export function Toast({ message, type = "error", duration, onDismiss, onRetry, persistent = false, stackIndex = 0 }) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Uniform short fade across every type — 3s lingered too long even
  // for errors and warnings. Error toasts that need persistence
  // (e.g. mutationError with a Reintentar) opt in via `persistent`,
  // and any caller can still override with an explicit duration prop.
  const effectiveDuration = duration ?? 1400;

  // Flip visibility synchronously when the message prop changes —
  // adjust-state-during-render so the toast enters/exits without a
  // set-state-in-effect cascade. The auto-dismiss timer stays in an
  // effect (legitimate async side-effect).
  const [prevMessage, setPrevMessage] = useState(message);
  if (message !== prevMessage) {
    setPrevMessage(message);
    if (message) { setVisible(true); setLeaving(false); }
    else { setVisible(false); }
  }
  useEffect(() => {
    if (!message || persistent) return;
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => { setVisible(false); onDismiss?.(); }, 180);
    }, effectiveDuration);
    return () => clearTimeout(timer);
  }, [message, effectiveDuration, onDismiss, persistent]);

  if (!visible || !message) return null;

  const bg = type === "error" ? "var(--red)" : type === "success" ? "var(--green)" : type === "warning" ? "var(--amber)" : "var(--charcoal)";
  const dismiss = () => { setLeaving(true); setTimeout(() => { setVisible(false); onDismiss?.(); }, 180); };

  // Type-specific icon — the message text alone left the toast feeling
  // homogeneous regardless of severity. A success toast and an error
  // toast are different kinds of message and the icon makes that
  // glanceable from the corner of the eye.
  const Icon = type === "success" ? IconCheck
    : type === "warning" || type === "error" ? GlyphAlert
    : null;

  // Stacking offset: each subsequent toast is ~58px further down, with
  // a slight scale fade so older entries recede visually rather than
  // fighting the newer one for attention.
  const top = `calc(var(--sat, 44px) + 52px + ${stackIndex * 58}px)`;
  const opacity = stackIndex === 0 ? 1 : Math.max(0.75, 1 - stackIndex * 0.1);
  const scale = stackIndex === 0 ? 1 : Math.max(0.94, 1 - stackIndex * 0.03);

  return (
    <div style={{
      position:"fixed", top, left:12, right:12,
      zIndex:"var(--z-install)", pointerEvents:"auto",
      animation: leaving
        ? "toastOut var(--dur-fast) var(--ease-out) forwards"
        : "toastIn var(--dur-slower) var(--ease-spring)",
      opacity,
      transform: `scale(${scale})`,
      transformOrigin: "top center",
      transition: "top var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)",
    }}>
      <div
        style={{
          background: bg, color:"var(--white)", padding:"12px 16px", borderRadius:"var(--radius)",
          fontSize:"var(--text-md)", fontWeight:600, fontFamily:"var(--font)",
          boxShadow:"var(--shadow-lg)",
          display:"flex", alignItems:"center", gap:12,
        }}>
        {Icon && (
          <span style={{
            display:"inline-flex", alignItems:"center", justifyContent:"center",
            width:24, height:24, borderRadius:"50%",
            background:"rgba(255,255,255,0.22)", color:"var(--white)",
            flexShrink:0,
          }} aria-hidden>
            <Icon size={14} />
          </span>
        )}
        <span role="button" tabIndex={0} onClick={dismiss}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dismiss(); } }}
          aria-label={t("close")}
          style={{ flex:1, cursor:"pointer", lineHeight:1.4 }}>{message}</span>
        {onRetry && (
          <button onClick={(e) => { e.stopPropagation(); onRetry(); dismiss(); }}
            style={{
              background:"rgba(255,255,255,0.22)", color:"var(--white)", border:"none",
              borderRadius:"var(--radius-pill)", padding:"4px 12px", fontSize:"var(--text-sm)", fontWeight:700,
              fontFamily:"var(--font)", cursor:"pointer", flexShrink:0, minHeight:0,
            }}>
            {t("retry")}
          </button>
        )}
        {/* Explicit dismiss button — the click-anywhere-to-dismiss was
            non-discoverable and persistent toasts had no obvious exit. */}
        {!onRetry && (
          <button onClick={(e) => { e.stopPropagation(); dismiss(); }}
            aria-label={t("close")}
            style={{
              background:"transparent", color:"rgba(255,255,255,0.85)", border:"none",
              padding:4, cursor:"pointer", flexShrink:0, minHeight:0,
              display:"inline-flex", alignItems:"center", justifyContent:"center",
              borderRadius:"50%",
            }}>
            <IconX size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * ToastStack — renders up to `max` toasts as a vertical stack,
 * newest at index 0 (top) and older entries offset below with a
 * subtle opacity + scale decay. Each entry auto-dismisses unless
 * marked persistent; clicking dismisses immediately.
 */
export function ToastStack({ toasts, onDismiss, max = 3 }) {
  const visible = toasts.slice(-max);
  // Reverse so the newest entry sits at the top (stackIndex 0).
  const reversed = [...visible].reverse();
  return reversed.map((toast, i) => (
    <Toast
      key={toast.id}
      stackIndex={i}
      message={toast.message}
      type={toast.kind}
      persistent={toast.persistent}
      onDismiss={() => onDismiss(toast.id)}
      onRetry={toast.onRetry}
    />
  ));
}
