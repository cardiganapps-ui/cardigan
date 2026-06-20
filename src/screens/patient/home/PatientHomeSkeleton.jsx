import { memo } from "react";

/* Skeleton mirrors PatientHome's first-paint structure: hero card
   (next session), balance row, "tu profesionista" card. Same widths
   + heights as the real cards so the swap-in feels continuous. The
   .sk-bar / .sk-circle classes already animate the cream shimmer. */
export const PatientHomeSkeleton = memo(function PatientHomeSkeleton() {
  return (
    <div aria-hidden style={{ padding: "16px 16px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Próxima sesión hero */}
      <div className="card" style={{ padding: 16 }}>
        <div className="sk-bar sk-bar-xs" style={{ width: "30%", marginBottom: 10 }} />
        <div className="sk-bar sk-bar-lg" style={{ width: "70%", marginBottom: 8 }} />
        <div className="sk-bar sk-bar-sm" style={{ width: "50%", marginBottom: 16 }} />
        <div style={{ display: "flex", gap: 12 }}>
          <div className="sk-bar sk-bar-md" style={{ width: 96, borderRadius: 100 }} />
          <div className="sk-bar sk-bar-md" style={{ width: 96, borderRadius: 100 }} />
        </div>
      </div>
      {/* Saldo */}
      <div className="card" style={{ padding: 16 }}>
        <div className="sk-bar sk-bar-xs" style={{ width: "20%", marginBottom: 10 }} />
        <div className="sk-bar sk-bar-lg" style={{ width: "55%", marginBottom: 6 }} />
        <div className="sk-bar sk-bar-sm" style={{ width: "35%" }} />
      </div>
      {/* Tu profesionista */}
      <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <div className="sk-circle" />
        <div style={{ flex: 1 }}>
          <div className="sk-bar sk-bar-md" style={{ width: "55%", marginBottom: 6 }} />
          <div className="sk-bar sk-bar-xs" style={{ width: "35%" }} />
        </div>
      </div>
    </div>
  );
});
