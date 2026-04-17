import { useState, useEffect } from "react";
import { useT } from "../i18n/index";

export function Toast({ message, type = "error", duration = 4000, onDismiss, onRetry, persistent = false }) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!message) { setVisible(false); return; }
    setVisible(true);
    setLeaving(false);
    if (persistent) return;
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => { setVisible(false); onDismiss?.(); }, 700);
    }, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDismiss, persistent]);

  if (!visible || !message) return null;

  const bg = type === "error" ? "var(--red)" : type === "success" ? "var(--green)" : type === "warning" ? "var(--amber)" : "var(--charcoal)";
  const dismiss = () => { setLeaving(true); setTimeout(() => { setVisible(false); onDismiss?.(); }, 700); };

  return (
    <div style={{
      position:"fixed", top:"calc(var(--sat, 44px) + 52px)", left:12, right:12,
      zIndex:"var(--z-install)", pointerEvents:"auto",
      animation: leaving ? "toastOut 0.5s ease forwards" : "toastIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
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
