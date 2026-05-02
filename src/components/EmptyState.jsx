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

  if (kind === "notes") {
    // Line-art notepad with a folded corner, spiral binding dots, and
    // a teal bookmark ribbon. The curved pen sits at the upper-right
    // to hint at the "start writing" action without a literal cursor.
    return (
      <svg width={size} height={size * 0.7} viewBox="0 0 200 140" aria-hidden="true">
        {/* Soft spotlight */}
        <circle cx="100" cy="72" r="58" fill={tint} opacity="0.4" />
        <ellipse cx="100" cy="122" rx="56" ry="6" fill={tint} opacity="0.55" />

        {/* Notepad body, folded-corner */}
        <path
          d="M 60 24
             L 132 24
             L 148 40
             L 148 114
             L 60 114 Z"
          fill="var(--white)"
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        {/* Folded corner highlight */}
        <path d="M 132 24 L 132 40 L 148 40"
          fill={tint} stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" />

        {/* Spiral binding dots */}
        <g fill={stroke}>
          <circle cx="60" cy="38" r="2.2" />
          <circle cx="60" cy="56" r="2.2" />
          <circle cx="60" cy="74" r="2.2" />
          <circle cx="60" cy="92" r="2.2" />
          <circle cx="60" cy="110" r="2.2" opacity="0.5" />
        </g>

        {/* Body text lines — faint so the shape reads as texture */}
        <g stroke={stroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.3">
          <line x1="74" y1="56" x2="136" y2="56" />
          <line x1="74" y1="70" x2="130" y2="70" />
          <line x1="74" y1="84" x2="120" y2="84" />
        </g>

        {/* Teal bookmark ribbon tucked under top edge */}
        <path
          d="M 110 22 L 110 52 L 118 46 L 126 52 L 126 22 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "mediciones") {
    // Outlined ruler-and-scale silhouette with a teal trend arc rising
    // through it. Reads as "we're here to track progress" without
    // resorting to a literal weight scale (too clinical) or a
    // generic chart icon (too anonymous). Same line-art treatment as
    // the receipt + notepad above so the family stays consistent.
    return (
      <svg width={size} height={size * 0.7} viewBox="0 0 200 140" aria-hidden="true">
        {/* Soft spotlight + ground shadow */}
        <circle cx="100" cy="72" r="58" fill={tint} opacity="0.4" />
        <ellipse cx="100" cy="122" rx="56" ry="6" fill={tint} opacity="0.55" />

        {/* Card backdrop — a "measurement card" silhouette */}
        <rect x="44" y="32" width="112" height="80" rx="10"
          fill="var(--white)" stroke={stroke} strokeWidth="2.2" />

        {/* Horizontal axis baseline */}
        <line x1="56" y1="92" x2="144" y2="92"
          stroke={stroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />

        {/* Trend curve — gentle upward arc, drawn left to right */}
        <path
          d="M 58 86 Q 78 80 92 72 T 124 56 T 142 46"
          fill="none"
          stroke={fill}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Datapoint dots along the curve */}
        <g fill={fill}>
          <circle cx="58"  cy="86" r="3" opacity="0.55" />
          <circle cx="92"  cy="72" r="3" opacity="0.75" />
          <circle cx="124" cy="56" r="3" />
          <circle cx="142" cy="46" r="3.6" />
        </g>

        {/* Tick marks on the X axis — quietly suggest "over time" */}
        <g stroke={stroke} strokeWidth="1.4" strokeLinecap="round" opacity="0.32">
          <line x1="64"  y1="92" x2="64"  y2="98" />
          <line x1="92"  y1="92" x2="92"  y2="98" />
          <line x1="120" y1="92" x2="120" y2="98" />
          <line x1="142" y1="92" x2="142" y2="98" />
        </g>
      </svg>
    );
  }

  if (kind === "documents") {
    // Two stacked sheets — the back one folded-corner style — sitting
    // above a soft spotlight. Uses outlined fills so the shape stays
    // legible in both light and dark modes; a small teal upload chevron
    // tucked into the lower-right corner hints at the primary action
    // without dragging in a literal arrow icon.
    return (
      <svg width={size} height={size * 0.7} viewBox="0 0 200 140" aria-hidden="true">
        <circle cx="100" cy="72" r="56" fill={tint} opacity="0.4" />
        <ellipse cx="100" cy="122" rx="56" ry="6" fill={tint} opacity="0.55" />

        {/* Back sheet — slightly offset, folded corner */}
        <path
          d="M 70 26 L 130 26 L 144 40 L 144 108 L 70 108 Z"
          fill="var(--white)" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round"
        />
        <path
          d="M 130 26 L 130 40 L 144 40"
          fill={tint} stroke={stroke} strokeWidth="2.2" strokeLinejoin="round"
        />
        <g stroke={stroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.32">
          <line x1="80" y1="56" x2="132" y2="56" />
          <line x1="80" y1="68" x2="124" y2="68" />
        </g>

        {/* Front sheet — overlaps to the lower right */}
        <path
          d="M 84 50 L 156 50 L 156 122 L 84 122 Z"
          fill="var(--white)" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round"
        />
        <g stroke={stroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.4">
          <line x1="94" y1="68" x2="146" y2="68" />
          <line x1="94" y1="80" x2="140" y2="80" />
          <line x1="94" y1="92" x2="130" y2="92" />
        </g>

        {/* Teal upload chevron in the lower-right of the front sheet —
           solid teal disc with a small white up-arrow inscribed. */}
        <circle cx="142" cy="108" r="11" fill={fill} stroke={stroke} strokeWidth="2" />
        <path
          d="M 142 102 L 142 114 M 138 106 L 142 102 L 146 106"
          fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "finances") {
    // Outlined receipt with a teal $-emblem. Line-art (no opaque
    // fills) so the shape reads on both light and dark backgrounds
    // — the prior stacked-ellipses "coin pile" washed out in dark
    // mode because it depended on --white which inverts. The zigzag
    // bottom is the classic receipt-tear silhouette.
    return (
      <svg width={size} height={size * 0.7} viewBox="0 0 200 140" aria-hidden="true">
        {/* Soft spotlight so the subject pops off the page */}
        <circle cx="100" cy="72" r="58" fill={tint} opacity="0.35" />
        <ellipse cx="100" cy="120" rx="54" ry="6" fill={tint} opacity="0.55" />

        {/* Receipt — outlined, no fill. Coords picked so the zigzag
           lands on even pixels at the default render size. */}
        <path
          d="M 66 26
             L 134 26
             L 134 100
             L 126 108 L 118 100 L 110 108 L 102 100
             L 94 108 L 86 100 L 78 108 L 70 100 L 66 104 Z"
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* $ chip — solid teal, pure-white glyph. The glyph uses a
           hard-coded white because the chip's teal is a constant,
           not theme-relative. */}
        <circle cx="100" cy="52" r="15" fill={fill} />
        <text
          x="100" y="58.5"
          textAnchor="middle"
          fontFamily="var(--font-d), Nunito, sans-serif"
          fontWeight="800"
          fontSize="17"
          fill="#FFFFFF"
        >$</text>

        {/* Placeholder "rows" on the receipt body — faint so they
           read as texture rather than content. */}
        <line x1="76" y1="78" x2="124" y2="78"
              stroke={stroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.32" />
        <line x1="76" y1="88" x2="112" y2="88"
              stroke={stroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.32" />
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
