/* ── Cardigan preset avatars ────────────────────────────────────────
   12 hand-drawn line-art SVGs in the same visual voice as the
   EmptyState illustrations: 2.2px stroke, rounded joins, teal-dark
   foreground, teal-pale tint halo on a teal-mist field. Each
   component accepts a single `size` prop; the SVG scales cleanly
   to 36 / 40 / 52 / 72 / 96 px.

   The registry exposes each preset as { id, label, Component }.
   Storage value is `preset:<id>` (e.g. `preset:sprig-01`). */

const STROKE = "var(--teal-dark)";
const ACCENT = "var(--teal)";
const TINT = "var(--teal-pale)";
const FIELD = "var(--teal-mist)";

/* A shared <svg> wrapper ensures every preset renders at identical
   dimensions and with the same circular field backdrop. Children
   supply the illustration content only. */
function Frame({ size = 72, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle cx="36" cy="36" r="36" fill={FIELD} />
      <circle cx="36" cy="36" r="30" fill={TINT} opacity="0.45" />
      {children}
    </svg>
  );
}

function Sprig({ size }) {
  return (
    <Frame size={size}>
      <g stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M36 54 Q36 40 44 30" />
        <path d="M40 44 Q34 42 30 36" />
        <path d="M42 36 Q38 32 34 28" />
        <path d="M44 30 Q42 24 44 20" />
      </g>
      <g fill={ACCENT} stroke={STROKE} strokeWidth="1.6">
        <ellipse cx="28" cy="38" rx="5" ry="3" transform="rotate(-20 28 38)" />
        <ellipse cx="32" cy="28" rx="5" ry="3" transform="rotate(-30 32 28)" />
        <ellipse cx="44" cy="22" rx="4" ry="2.5" transform="rotate(30 44 22)" />
      </g>
    </Frame>
  );
}

function Flower({ size }) {
  return (
    <Frame size={size}>
      <g stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M36 58 Q36 48 36 40" />
        <path d="M36 50 Q30 48 28 44" />
      </g>
      <g fill={ACCENT} stroke={STROKE} strokeWidth="1.8" strokeLinejoin="round">
        <ellipse cx="36" cy="22" rx="5" ry="7" />
        <ellipse cx="26" cy="28" rx="7" ry="5" transform="rotate(-25 26 28)" />
        <ellipse cx="46" cy="28" rx="7" ry="5" transform="rotate(25 46 28)" />
        <ellipse cx="30" cy="38" rx="6" ry="4.5" transform="rotate(-55 30 38)" />
        <ellipse cx="42" cy="38" rx="6" ry="4.5" transform="rotate(55 42 38)" />
      </g>
      <circle cx="36" cy="30" r="3.2" fill="var(--white)" stroke={STROKE} strokeWidth="1.6" />
    </Frame>
  );
}

function Leaf({ size }) {
  return (
    <Frame size={size}>
      <g stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M22 46 Q22 24 46 22 Q48 40 28 50 Q24 50 22 46 Z"
          fill={ACCENT}
          fillOpacity="0.85"
        />
        <path d="M26 48 Q36 36 46 24" fill="none" stroke="var(--white)" strokeWidth="1.6" opacity="0.85" />
        <path d="M32 42 Q34 38 30 34" fill="none" />
        <path d="M38 36 Q40 32 36 28" fill="none" />
      </g>
    </Frame>
  );
}

function Sun({ size }) {
  return (
    <Frame size={size}>
      <g stroke={STROKE} strokeWidth="2.2" strokeLinecap="round">
        <line x1="36" y1="12" x2="36" y2="18" />
        <line x1="36" y1="54" x2="36" y2="60" />
        <line x1="12" y1="36" x2="18" y2="36" />
        <line x1="54" y1="36" x2="60" y2="36" />
        <line x1="19" y1="19" x2="24" y2="24" />
        <line x1="48" y1="48" x2="53" y2="53" />
        <line x1="53" y1="19" x2="48" y2="24" />
        <line x1="19" y1="53" x2="24" y2="48" />
      </g>
      <circle cx="36" cy="36" r="10" fill={ACCENT} stroke={STROKE} strokeWidth="2.2" />
    </Frame>
  );
}

function Moon({ size }) {
  return (
    <Frame size={size}>
      <path
        d="M48 20 A18 18 0 1 0 52 50 A14 14 0 1 1 48 20 Z"
        fill={ACCENT}
        stroke={STROKE}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <g fill={STROKE}>
        <circle cx="24" cy="22" r="1.4" />
        <circle cx="20" cy="32" r="1" />
      </g>
      <g stroke={STROKE} strokeWidth="1.4" strokeLinecap="round">
        <path d="M28 16 l0 3 M26.5 17.5 l3 0" />
      </g>
    </Frame>
  );
}

function Wave({ size }) {
  return (
    <Frame size={size}>
      <g fill="none" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 42 Q22 32 30 42 T46 42 T62 42" />
        <path d="M14 50 Q22 40 30 50 T46 50 T62 50" opacity="0.75" />
        <path d="M14 34 Q22 24 30 34 T46 34 T62 34" opacity="0.5" />
      </g>
      <circle cx="36" cy="22" r="4" fill={ACCENT} stroke={STROKE} strokeWidth="1.8" />
    </Frame>
  );
}

function Mountain({ size }) {
  return (
    <Frame size={size}>
      <g stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 52 L28 28 L40 44 L50 32 L60 52 Z" fill={ACCENT} fillOpacity="0.85" />
        <path d="M24 34 L28 28 L33 34" fill="var(--white)" stroke="var(--white)" strokeWidth="1.4" />
        <path d="M46 38 L50 32 L54 38" fill="var(--white)" stroke="var(--white)" strokeWidth="1.4" />
      </g>
      <circle cx="54" cy="20" r="3.5" fill={STROKE} opacity="0.35" />
    </Frame>
  );
}

function Arch({ size }) {
  return (
    <Frame size={size}>
      <g fill="none" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round">
        <path d="M16 50 A20 20 0 0 1 56 50" />
        <path d="M22 50 A14 14 0 0 1 50 50" opacity="0.75" />
        <path d="M28 50 A8 8 0 0 1 44 50" opacity="0.5" />
      </g>
      <circle cx="36" cy="50" r="2.4" fill={ACCENT} />
    </Frame>
  );
}

function Heart({ size }) {
  return (
    <Frame size={size}>
      <path
        d="M36 54 C22 44 16 36 18 28 C20 20 30 20 36 28 C42 20 52 20 54 28 C56 36 50 44 36 54 Z"
        fill={ACCENT}
        fillOpacity="0.9"
        stroke={STROKE}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M26 28 Q28 24 32 24"
        fill="none"
        stroke="var(--white)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.85"
      />
    </Frame>
  );
}

function CardiganGarment({ size }) {
  return (
    <Frame size={size}>
      <g stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {/* Cardigan body */}
        <path
          d="M18 28 L28 18 L34 22 L38 22 L44 18 L54 28 L52 54 L40 56 L36 54 L32 56 L20 54 Z"
          fill={ACCENT}
          fillOpacity="0.85"
        />
        {/* Front opening */}
        <path d="M36 22 L36 54" />
        {/* Knit-pattern hints */}
        <g stroke="var(--white)" strokeWidth="1" opacity="0.7">
          <line x1="24" y1="32" x2="33" y2="32" />
          <line x1="24" y1="38" x2="33" y2="38" />
          <line x1="24" y1="44" x2="33" y2="44" />
          <line x1="39" y1="32" x2="48" y2="32" />
          <line x1="39" y1="38" x2="48" y2="38" />
          <line x1="39" y1="44" x2="48" y2="44" />
        </g>
      </g>
      {/* Buttons */}
      <g fill={STROKE}>
        <circle cx="36" cy="30" r="1.6" />
        <circle cx="36" cy="38" r="1.6" />
        <circle cx="36" cy="46" r="1.6" />
      </g>
    </Frame>
  );
}

function YarnBall({ size }) {
  return (
    <Frame size={size}>
      <circle cx="36" cy="38" r="16" fill={ACCENT} stroke={STROKE} strokeWidth="2.2" />
      <g fill="none" stroke="var(--white)" strokeWidth="1.6" strokeLinecap="round" opacity="0.9">
        <path d="M24 32 Q36 26 48 32" />
        <path d="M22 38 Q36 32 50 38" />
        <path d="M24 44 Q36 38 48 44" />
        <path d="M30 26 Q36 44 42 50" />
      </g>
      <path
        d="M52 32 Q58 26 56 18"
        fill="none"
        stroke={STROKE}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="56" cy="18" r="1.8" fill={STROKE} />
    </Frame>
  );
}

function Spark({ size }) {
  return (
    <Frame size={size}>
      <g fill={ACCENT} stroke={STROKE} strokeWidth="2" strokeLinejoin="round">
        <path d="M36 16 L40 34 L58 36 L40 38 L36 56 L32 38 L14 36 L32 34 Z" />
      </g>
      <g fill="none" stroke={STROKE} strokeWidth="1.6" strokeLinecap="round">
        <path d="M22 22 L24 26" />
        <path d="M50 22 L48 26" />
        <path d="M22 50 L24 46" />
        <path d="M50 50 L48 46" />
      </g>
    </Frame>
  );
}

export {
  Sprig,
  Flower,
  Leaf,
  Sun,
  Moon,
  Wave,
  Mountain,
  Arch,
  Heart,
  CardiganGarment,
  YarnBall,
  Spark,
};
