import { useState, useEffect } from "react";
import { useT } from "../i18n/index";

export function Toast({ message, type = "error", duration, onDismiss, onRetry, persistent = false, stackIndex = 0 }) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Acknowledgement toasts (success + info) are brief confirmations —
  // "Guardado", "Eliminado", "Recordatorios desactivados". Lingering
  // 3s on a simple "done" feels sluggish, so they fade at 1.4s.
  // Warnings and errors keep the longer window — the user may need
  // time to read the problem and decide whether to tap Reintentar.
  const effectiveDuration =
    duration ?? (type === "success" || type === "info" ? 1400 : 3000);

  useEffect(() => {
    if (!message) { setVisible(false); return; }
    setVisible(true);
    setLeaving(false);
    if (persistent) return;
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => { setVisible(false); onDismiss?.(); }, 180);
    }, effectiveDuration);
    return () => clearTimeout(timer);
  }, [message, effectiveDuration, onDismiss, persistent]);

  if (!visible || !message) return null;

  const bg = type === "error" ? "var(--red)" : type === "success" ? "var(--green)" : type === "warning" ? "var(--amber)" : "var(--charcoal)";
  const dismiss = () => { setLeaving(true); setTimeout(() => { setVisible(false); onDismiss?.(); }, 180); };

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
      animation: leaving ? "toastOut 0.18s ease forwards" : "toastIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)",
      opacity,
      transform: `scale(${scale})`,
      transformOrigin: "top center",
      transition: "top 0.22s ease, transform 0.22s ease, opacity 0.22s ease",
    }}>
      <div
        style={{
          background: bg, color:"var(--white)", padding:"12px 16px", borderRadius:"var(--radius)",
          fontSize:"var(--text-md)", fontWeight:600, fontFamily:"var(--font)",
          boxShadow:"var(--shadow-lg)",
          display:"flex", alignItems:"center", gap:10,
        }}>
        <span onClick={dismiss} style={{ flex:1, cursor:"pointer" }}>{message}</span>
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
