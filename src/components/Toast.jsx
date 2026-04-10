import { useState, useEffect } from "react";

export function Toast({ message, type = "error", duration = 4000, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!message) { setVisible(false); return; }
    setVisible(true);
    setLeaving(false);
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => { setVisible(false); onDismiss?.(); }, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDismiss]);

  if (!visible || !message) return null;

  const bg = type === "error" ? "var(--red)" : type === "success" ? "var(--green)" : "var(--charcoal)";

  return (
    <div style={{
      position:"fixed", top:"calc(var(--sat, 44px) + 52px)", left:12, right:12,
      zIndex:"var(--z-install)", pointerEvents:"auto",
      animation: leaving ? "toastOut 0.3s ease forwards" : "toastIn 0.3s ease",
    }}>
      <div onClick={() => { setLeaving(true); setTimeout(() => { setVisible(false); onDismiss?.(); }, 300); }}
        style={{
          background: bg, color:"white", padding:"12px 16px", borderRadius:"var(--radius)",
          fontSize:13, fontWeight:600, fontFamily:"var(--font)",
          boxShadow:"0 4px 20px rgba(0,0,0,0.2)", cursor:"pointer",
        }}>
        {message}
      </div>
    </div>
  );
}
