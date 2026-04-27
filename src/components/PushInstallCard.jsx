import { IconBell } from "./Icons";
import { useT } from "../i18n/index";

/* Card shown in place of the notifications toggle when the user is on
   iOS Safari but hasn't installed Cardigan to their Home Screen. iOS
   gives us no programmatic way to trigger add-to-homescreen, so the
   job is purely instructional: explain what to do, and get out of the
   way. */

function IconShare({ size = 16 }) {
  // Minimal iOS share-sheet glyph (up arrow out of a tray).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 3v12M12 3l-4 4M12 3l4 4" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconPlusSquare({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/>
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function IconHome({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1v-9z"
            stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    </svg>
  );
}

export function PushInstallCard() {
  const { t } = useT();
  const steps = [
    { icon: <IconShare size={16} />, label: t("notifications.installStep1") },
    { icon: <IconPlusSquare size={16} />, label: t("notifications.installStep2") },
    { icon: <IconHome size={16} />, label: t("notifications.installStep3") },
  ];
  return (
    <div
      className="card"
      style={{
        margin: "0 16px",
        padding: "16px 16px 14px",
        background: "var(--teal-pale)",
        border: "1px solid var(--teal-mist)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          flexShrink: 0,
          width: 36, height: 36, borderRadius: "50%",
          background: "var(--teal)", color: "var(--white)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconBell size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-d)", fontWeight: 800,
            fontSize: "var(--text-md)", color: "var(--charcoal)",
            lineHeight: 1.3,
          }}>
            {t("notifications.installTitle")}
          </div>
          <div style={{
            fontSize: "var(--text-sm)", color: "var(--charcoal-md)",
            marginTop: 4, lineHeight: 1.4,
          }}>
            {t("notifications.installBody")}
          </div>
        </div>
      </div>
      <ol style={{
        listStyle: "none",
        padding: 0,
        margin: "12px 0 0",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        {steps.map((s, i) => (
          <li key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px",
            background: "rgba(255,255,255,0.55)",
            borderRadius: 10,
            fontSize: "var(--text-sm)",
            color: "var(--charcoal)",
          }}>
            <span style={{
              flexShrink: 0,
              width: 22, height: 22, borderRadius: "50%",
              background: "var(--teal)", color: "var(--white)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 800,
            }}>{i + 1}</span>
            <span style={{
              flexShrink: 0, color: "var(--teal-dark, var(--teal))",
              display: "flex", alignItems: "center",
            }}>{s.icon}</span>
            <span style={{ lineHeight: 1.3 }}>{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
