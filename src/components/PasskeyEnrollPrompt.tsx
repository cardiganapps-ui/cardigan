import { useEffect, useState } from "react";
import { IconX, IconKey } from "./Icons";
import { useT } from "../i18n/index";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { haptic } from "../utils/haptics";

/* ── PasskeyEnrollPrompt ──────────────────────────────────────────────
   One-time, gentle nudge shown after login offering to set up a passkey
   for faster sign-in next time. Render-only: all gating (passkeys
   supported, user has zero passkeys, not previously dismissed) lives in
   the parent (App.jsx), which also owns the WebAuthn ceremony via
   usePasskeys.register(). `creating` drives the button's pending state;
   `onCreate` should resolve when the ceremony finishes. */
export default function PasskeyEnrollPrompt({ open, creating, onCreate, onDismiss }: { open?: boolean; creating?: boolean; onCreate: () => void; onDismiss?: () => void }) {
  const { t } = useT();
  const [mounted, setMounted] = useState(false);
  const panelRef = useFocusTrap(!!open);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(false);
      return;
    }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  return (
    // backdrop scrim: dismissal is a mouse convenience; keyboard users dismiss via Escape + the in-panel controls
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="passkey-prompt-title"
      onClick={creating ? undefined : (e) => { if (e.target === e.currentTarget) onDismiss?.(); }}
      style={{
        position: "fixed", inset: 0,
        background: "var(--scrim-bg)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 665,
        padding: 16,
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.32s ease",
      }}
    >
      <div
        ref={(el) => { panelRef.current = el; }}
        style={{
          background: "var(--white)",
          borderRadius: "var(--radius-lg, 16px)",
          maxWidth: 420, width: "100%",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
          transform: mounted ? "translateY(0) scale(1)" : "translateY(18px) scale(0.98)",
          transition: "transform 0.42s var(--ease-spring)",
        }}
      >
        <div style={{
          position: "relative",
          background: "linear-gradient(160deg, var(--teal-pale) 0%, var(--cream) 100%)",
          padding: "30px 24px 24px",
          textAlign: "center",
        }}>
          <button
            type="button"
            onClick={onDismiss}
            disabled={creating}
            aria-label={t("close")}
            style={{
              position: "absolute", top: 14, right: 14,
              width: 32, height: 32, borderRadius: 999,
              background: "rgba(255,255,255,0.7)",
              border: "none", cursor: creating ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--charcoal-md)",
            }}
          >
            <IconX size={14} />
          </button>
          <div style={{
            width: 60, height: 60, borderRadius: "50%",
            background: "var(--white)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px",
            color: "var(--teal-dark)",
            boxShadow: "var(--shadow)",
          }}>
            <IconKey size={26} />
          </div>
          <div
            id="passkey-prompt-title"
            style={{
              fontFamily: "var(--font-d)", fontSize: 22, fontWeight: 800,
              color: "var(--charcoal)", letterSpacing: "-0.4px",
              lineHeight: 1.2, marginBottom: 8,
            }}
          >
            {t("settings.passkeyPromptTitle")}
          </div>
          <div style={{
            fontSize: 14, color: "var(--charcoal-md)",
            lineHeight: 1.5, maxWidth: 340, margin: "0 auto",
          }}>
            {t("settings.passkeyPromptBody")}
          </div>
        </div>

        <div style={{ padding: "18px 22px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary-teal"
            disabled={creating}
            onClick={() => { haptic.tap?.(); onCreate(); }}
          >
            {creating ? t("settings.passkeyAdding") : t("settings.passkeyPromptCta")}
          </button>
          <button type="button" className="btn btn-ghost" disabled={creating} onClick={onDismiss}>
            {t("settings.passkeyPromptDismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
