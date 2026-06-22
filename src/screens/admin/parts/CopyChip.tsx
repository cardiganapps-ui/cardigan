import { useState } from "react";
import { useT } from "../../../i18n/index";

/* ── CopyChip ──
   Click-to-copy chip used on Codes screens for code values + share
   links. Resets the "copied" indicator after 1.6s. Lifted from
   AdminPanel.jsx (legacy modal). */
export function CopyChip({ text, label }: { text: string; label?: React.ReactNode }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 12px",
        background: "var(--cream)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--charcoal-xl)", marginBottom: 2 }}>
          {label}
        </div>
        <div style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 12,
          color: "var(--charcoal)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {text}
        </div>
      </div>
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        color: copied ? "var(--green)" : "var(--teal-dark)",
        flexShrink: 0,
      }}>
        {copied ? t("admin.codesCopied") : t("admin.codesCopy")}
      </span>
    </button>
  );
}
