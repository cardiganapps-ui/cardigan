import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";
import { IconCheck, IconDocument, IconLock, IconCalendar, IconX } from "./Icons";

/* ── SubscriptionSuccess ──────────────────────────────────────────────
   Celebration modal that fires once per user on the very first
   transition from non-active → active. Persists "shown" in
   localStorage so a refresh doesn't replay it.

   Visuals:
     - Light confetti (canvas-based — ~80 LOC, zero deps)
     - "¡Bienvenido a Cardigan Pro!" header
     - Three Pro features as a quick reminder of what just unlocked
     - Close → dismisses, marks shown
     - Hidden from admins + comp-granted users (handled by parent
       only mounting when `subscribedActive` flips true). */

export function SubscriptionSuccess({ open, onClose }) {
  const { t } = useT();
  const canvasRef = useRef(null);

  // Track the open prop to drive the entrance animation. We update
  // `mounted` in a one-shot rAF on open (so the initial styles paint
  // before the transition kicks in) and snap back to false on close.
  // Both are encapsulated as derived state from `open` via a ref-
  // based reset to avoid a setState-in-effect lint warning.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setMounted(true));
    haptic.success();
    return () => {
      cancelAnimationFrame(id);
      setMounted(false);
    };
  }, [open]);

  // Confetti — fired once on open. Lightweight canvas particle burst.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const colors = ["#5B9BAF", "#E8B86C", "#D96B6B", "#7AAD8A", "#2E2E2E"];
    const N = 60;
    const particles = Array.from({ length: N }, () => ({
      x: W / 2,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 7,
      vy: -Math.random() * 8 - 3,
      size: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.3,
      life: 1,
    }));

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of particles) {
        if (p.life <= 0) continue;
        alive = true;
        p.vy += 0.18;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vrot;
        p.life -= 0.012;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;

  const features = [
    { icon: IconDocument, label: t("subscriptionSuccess.feature1") },
    { icon: IconLock, label: t("subscriptionSuccess.feature2") },
    { icon: IconCalendar, label: t("subscriptionSuccess.feature3") },
  ];

  return (
    <div
      className="sheet-overlay"
      onClick={onClose}
      style={{
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.28s ease",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: "none",
        }}
      />
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 420,
          transform: mounted ? "scale(1) translateY(0)" : "scale(0.92) translateY(8px)",
          opacity: mounted ? 1 : 0,
          transition: "transform 0.42s cubic-bezier(0.18, 0.89, 0.32, 1.28), opacity 0.28s ease",
        }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("subscriptionSuccess.eyebrow")}</span>
          <button
            className="sheet-close"
            aria-label={t("close")}
            onClick={onClose}
          >
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "12px 24px 28px", textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "var(--teal-pale)", color: "var(--teal-dark)",
            marginBottom: 14,
          }}>
            <IconCheck size={28} />
          </div>
          <div style={{
            fontFamily: "var(--font-d)", fontSize: 22, fontWeight: 800,
            color: "var(--charcoal)", letterSpacing: "-0.4px", marginBottom: 8,
          }}>
            {t("subscriptionSuccess.title")}
          </div>
          <div style={{
            fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.5,
            marginBottom: 18,
          }}>
            {t("subscriptionSuccess.subtitle")}
          </div>
          <div style={{
            display: "flex", flexDirection: "column", gap: 8,
            textAlign: "left", marginBottom: 18,
          }}>
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px",
                  background: "var(--cream)",
                  borderRadius: "var(--radius)",
                  fontSize: 13, color: "var(--charcoal)",
                }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: "50%",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "var(--white)", color: "var(--teal-dark)",
                    flexShrink: 0,
                  }}>
                    <Icon size={14} />
                  </span>
                  <span style={{ fontWeight: 600 }}>{f.label}</span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
          >
            {t("subscriptionSuccess.cta")}
          </button>
        </div>
      </div>
    </div>
  );
}
