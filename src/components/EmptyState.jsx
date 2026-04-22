/* Reusable empty-state card with an illustration + warm copy + optional
   CTA. Replaces the terse "plain text + button" fallback that screens
   rendered when their domain list was empty. Three line-art variants
   currently — patients / agenda / finances — each keyed by the `kind`
   prop so the visuals stay consistent across screens without the
   caller wiring up an icon. */

function EmptyIllustration({ kind, size = 160 }) {
  const stroke = "var(--teal-dark)";
  const fill = "var(--teal)";
  const tint = "var(--teal-pale)";

  if (kind === "patients") {
    return (
      <svg width={size} height={size * 0.7} viewBox="0 0 200 140" aria-hidden="true">
        <ellipse cx="100" cy="120" rx="80" ry="8" fill={tint} opacity="0.7" />
        <g stroke={stroke} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" fill="var(--white)">
          <circle cx="78" cy="48" r="18" />
          <path d="M48 106 Q48 75 78 75 Q108 75 108 106 Z" />
        </g>
        <g stroke={stroke} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
          <circle cx="132" cy="56" r="14" fill={fill} fillOpacity="0.85" />
          <path d="M108 108 Q108 82 132 82 Q156 82 156 108 Z" fill={fill} fillOpacity="0.85" />
        </g>
      </svg>
    );
  }

  if (kind === "agenda") {
    return (
      <svg width={size} height={size * 0.7} viewBox="0 0 200 140" aria-hidden="true">
        <ellipse cx="100" cy="128" rx="78" ry="7" fill={tint} opacity="0.6" />
        <rect x="46" y="34" width="108" height="86" rx="10" fill="var(--white)" stroke={stroke} strokeWidth="2.4" />
        <rect x="46" y="34" width="108" height="24" rx="10" fill={fill} />
        <rect x="46" y="50" width="108" height="8" fill={fill} />
        <g stroke={stroke} strokeWidth="2.4" strokeLinecap="round">
          <line x1="66" y1="26" x2="66" y2="42" />
          <line x1="134" y1="26" x2="134" y2="42" />
        </g>
        <g fill={fill}>
          <circle cx="70" cy="78" r="3" />
          <circle cx="92" cy="78" r="3" opacity="0.55" />
          <circle cx="114" cy="78" r="3" opacity="0.3" />
          <circle cx="136" cy="78" r="3" opacity="0.55" />
          <circle cx="70" cy="98" r="3" opacity="0.55" />
          <circle cx="92" cy="98" r="3" />
          <circle cx="114" cy="98" r="3" opacity="0.55" />
        </g>
      </svg>
    );
  }

  if (kind === "finances") {
    return (
      <svg width={size} height={size * 0.7} viewBox="0 0 200 140" aria-hidden="true">
        <ellipse cx="100" cy="122" rx="60" ry="8" fill={tint} opacity="0.7" />
        <g stroke={stroke} strokeWidth="2.4" strokeLinejoin="round">
          <ellipse cx="100" cy="100" rx="48" ry="10" fill={fill} />
          <ellipse cx="100" cy="80" rx="48" ry="10" fill="var(--teal-pale)" />
          <ellipse cx="100" cy="60" rx="48" ry="10" fill={fill} />
          <ellipse cx="100" cy="40" rx="48" ry="10" fill="var(--white)" />
        </g>
        <text x="100" y="46" textAnchor="middle" fontFamily="var(--font-d)"
              fontWeight="800" fontSize="18" fill={stroke}>$</text>
      </svg>
    );
  }

  return null;
}

export function EmptyState({ kind, title, body, cta, compact = false }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      textAlign: "center",
      padding: compact ? "18px 18px 22px" : "28px 24px 32px",
      color: "var(--charcoal-xl)",
      // Tiny fade-in so empty states don't pop hard when a screen first
      // mounts or a filter wipes the list.
      animation: "fadeIn 0.35s ease",
    }}>
      <EmptyIllustration kind={kind} size={compact ? 130 : 170} />
      {title && (
        <div style={{
          marginTop: 10,
          fontFamily: "var(--font-d)",
          fontSize: compact ? 15 : 17,
          fontWeight: 800,
          color: "var(--charcoal)",
        }}>
          {title}
        </div>
      )}
      {body && (
        <div style={{
          marginTop: 6,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--charcoal-xl)",
          maxWidth: 280,
        }}>
          {body}
        </div>
      )}
      {cta && <div style={{ marginTop: 16 }}>{cta}</div>}
    </div>
  );
}

// Re-export so a caller that wants just the art (e.g. in a tighter
// layout) can use it without the surrounding chrome.
export { EmptyIllustration };
