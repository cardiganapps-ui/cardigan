/* ── Cardigan preset avatars ────────────────────────────────────────
   12 illustrated avatars replicating the hand-drawn reference:
   each subject drawn above a signature teal V-neck cardigan with
   rounded shoulders, a visible button, and a subtle center seam.
   Backgrounds are per-subject pastels; Moon is the outlier on a
   deep navy-teal night field.

   100×100 viewBox with a 50-radius circular backdrop. Cardigan
   primitive is shared; Plant uses a cream variant as the pot. */

const OUTLINE = "#2E3C44";
const TEAL = "#5E8F97";
const TEAL_DARK = "#457680";
const TEAL_LIGHT = "#8DB0B7";
const CREAM = "#F4EDDE";
const CREAM_SOFT = "#FAF3E5";
const WHITE = "#FFFFFF";

function Frame({ size = 72, bg, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle cx="50" cy="50" r="50" fill={bg} />
      {children}
    </svg>
  );
}

/* V-neck cardigan — fills lower ~45% of frame with rounded
   shoulders at y=54, the V dipping to (50, 72), and a button at
   (50, 84). The subtle center seam runs from the V down through
   the button. */
function Cardigan({ color = TEAL }) {
  return (
    <g stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path
        d="M 8 100
           L 8 68
           C 8 60 12 55 22 54
           L 38 52
           L 50 72
           L 62 52
           L 78 54
           C 88 55 92 60 92 68
           L 92 100 Z"
        fill={color}
      />
      <line x1="50" y1="76" x2="50" y2="92" stroke={OUTLINE} strokeWidth="0.8" opacity="0.32" />
      <circle cx="50" cy="84" r="1.8" fill={OUTLINE} />
    </g>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SUBJECTS
   ═══════════════════════════════════════════════════════════════════ */

function Dog({ size }) {
  return (
    <Frame size={size} bg="#DFE8DE">
      {/* Floppy ears — drawn first, hang alongside the face */}
      <g fill={CREAM_SOFT} stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round">
        <path d="M 26 22 C 20 32 21 42 27 50 C 32 48 36 42 36 34 C 36 28 32 22 26 22 Z" />
        <path d="M 74 22 C 80 32 79 42 73 50 C 68 48 64 42 64 34 C 64 28 68 22 74 22 Z" />
      </g>
      {/* Head */}
      <path
        d="M 30 32
           C 30 18 42 14 50 14
           C 58 14 70 18 70 32
           C 70 44 64 54 50 54
           C 36 54 30 44 30 32 Z"
        fill={CREAM_SOFT}
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Eyes */}
      <ellipse cx="42" cy="32" rx="1.8" ry="2" fill={OUTLINE} />
      <ellipse cx="58" cy="32" rx="1.8" ry="2" fill={OUTLINE} />
      {/* Nose */}
      <ellipse cx="50" cy="42" rx="3.2" ry="2.4" fill={OUTLINE} />
      {/* Mouth */}
      <path
        d="M 50 44.5 L 50 48 M 46 50 Q 48.5 52 50 50 Q 51.5 52 54 50"
        stroke={OUTLINE}
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
      />
      <Cardigan />
    </Frame>
  );
}

function Cat({ size }) {
  return (
    <Frame size={size} bg="#DCD4E7">
      {/* Pointed ears */}
      <g fill={CREAM_SOFT} stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round">
        <path d="M 30 30 L 34 14 L 44 28 Z" />
        <path d="M 70 30 L 66 14 L 56 28 Z" />
      </g>
      {/* Head */}
      <path
        d="M 30 32
           C 30 22 38 18 50 18
           C 62 18 70 22 70 32
           C 70 46 62 54 50 54
           C 38 54 30 46 30 32 Z"
        fill={CREAM_SOFT}
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Eyes */}
      <circle cx="42" cy="34" r="1.6" fill={OUTLINE} />
      <circle cx="58" cy="34" r="1.6" fill={OUTLINE} />
      {/* Nose */}
      <path d="M 47.5 40 L 52.5 40 L 50 42.8 Z" fill={OUTLINE} />
      {/* Mouth */}
      <path
        d="M 50 42.8 L 50 44 M 46 45.5 Q 48 47 50 45.5 Q 52 47 54 45.5"
        stroke={OUTLINE}
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Whiskers */}
      <g stroke={OUTLINE} strokeWidth="1" strokeLinecap="round">
        <line x1="28" y1="40" x2="40" y2="42" />
        <line x1="28" y1="44" x2="40" y2="45" />
        <line x1="72" y1="40" x2="60" y2="42" />
        <line x1="72" y1="44" x2="60" y2="45" />
      </g>
      <Cardigan color={TEAL_LIGHT} />
    </Frame>
  );
}

function Plant({ size }) {
  // The cardigan IS the pot (cream, knit).
  return (
    <Frame size={size} bg="#F0E6D3">
      {/* Stem */}
      <path
        d="M 50 54 L 50 30"
        stroke={OUTLINE}
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      {/* Left leaf */}
      <path
        d="M 50 34 C 38 32 30 22 30 18 C 40 20 48 28 50 32 Z"
        fill={TEAL_DARK}
        stroke={OUTLINE}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Center top leaf */}
      <path
        d="M 50 30 C 46 24 44 18 46 10 C 52 14 54 22 52 28 Z"
        fill={TEAL}
        stroke={OUTLINE}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Right leaf */}
      <path
        d="M 50 34 C 62 32 70 22 70 18 C 60 20 52 28 50 32 Z"
        fill={TEAL}
        stroke={OUTLINE}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Cream cardigan pot */}
      <g stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M 8 100
             L 8 68
             C 8 60 12 55 22 54
             L 38 52
             L 50 72
             L 62 52
             L 78 54
             C 88 55 92 60 92 68
             L 92 100 Z"
          fill={CREAM}
        />
        {/* Knit ridges — short vertical ticks on both panels */}
        <g stroke={OUTLINE} strokeWidth="0.7" opacity="0.32" strokeLinecap="round">
          <line x1="18" y1="64" x2="18" y2="96" />
          <line x1="24" y1="62" x2="24" y2="96" />
          <line x1="30" y1="60" x2="30" y2="96" />
          <line x1="36" y1="60" x2="36" y2="96" />
          <line x1="64" y1="60" x2="64" y2="96" />
          <line x1="70" y1="60" x2="70" y2="96" />
          <line x1="76" y1="62" x2="76" y2="96" />
          <line x1="82" y1="64" x2="82" y2="96" />
        </g>
        <line x1="50" y1="76" x2="50" y2="92" stroke={OUTLINE} strokeWidth="0.8" opacity="0.32" />
        <circle cx="50" cy="84" r="1.8" fill={OUTLINE} />
      </g>
    </Frame>
  );
}

function Coffee({ size }) {
  return (
    <Frame size={size} bg="#DBE3E7">
      {/* Steam wisp */}
      <path
        d="M 50 10 C 46 16 52 22 48 28 C 44 34 50 40 48 46"
        stroke={OUTLINE}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Mug */}
      <g stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round">
        <path
          d="M 28 38
             L 30 60
             C 30 64 34 66 38 66
             L 62 66
             C 66 66 70 64 70 60
             L 72 38 Z"
          fill={CREAM_SOFT}
        />
        {/* Handle */}
        <path
          d="M 72 44 C 82 44 82 58 70 58"
          fill="none"
          strokeLinecap="round"
        />
        {/* Coffee top */}
        <ellipse cx="50" cy="38" rx="22" ry="2.8" fill="#6E4A30" stroke={OUTLINE} strokeWidth="1.6" />
      </g>
      <Cardigan />
    </Frame>
  );
}

function Mountain({ size }) {
  return (
    <Frame size={size} bg="#DAD3E4">
      {/* Small cloud upper right */}
      <path
        d="M 68 26
           C 66 22 70 20 74 22
           C 76 18 82 18 84 22
           C 88 22 88 28 84 28
           L 70 28
           C 66 28 66 24 68 26 Z"
        fill={CREAM_SOFT}
        stroke={OUTLINE}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Back peak (darker, taller) */}
      <path
        d="M 30 70 L 56 22 L 82 70 Z"
        fill={TEAL_DARK}
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Front peak */}
      <path
        d="M 10 72 L 36 28 L 62 72 Z"
        fill={TEAL}
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Snow cap */}
      <path
        d="M 28 40 L 36 28 L 44 40 C 40 44 36 44 32 42 C 30 42 28 42 28 40 Z"
        fill={CREAM_SOFT}
        stroke={OUTLINE}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <Cardigan />
    </Frame>
  );
}

function Cloud({ size }) {
  return (
    <Frame size={size} bg="#DAE6E0">
      {/* Fluffy cloud — bumpy top, flatter bottom */}
      <path
        d="M 22 52
           C 14 52 14 42 22 40
           C 22 32 30 28 36 32
           C 40 22 54 22 58 32
           C 66 28 76 32 76 40
           C 82 40 82 52 76 52 Z"
        fill={CREAM_SOFT}
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <Cardigan color={TEAL_LIGHT} />
    </Frame>
  );
}

function Book({ size }) {
  return (
    <Frame size={size} bg="#F0E8D5">
      {/* Book stands upright — teal cover with button (shared with cardigan) */}
      <g stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round">
        {/* Shadow behind book — left edge showing pages */}
        <rect x="30" y="18" width="40" height="70" rx="2" fill={TEAL} />
        {/* Cream pages peek on right */}
        <rect x="67" y="20" width="3" height="66" fill={CREAM_SOFT} stroke="none" />
        <line x1="68.5" y1="20" x2="68.5" y2="86" stroke={OUTLINE} strokeWidth="0.8" opacity="0.4" />
        {/* Spine — left edge */}
        <line x1="30" y1="20" x2="30" y2="86" stroke={OUTLINE} strokeWidth="2" />
        {/* Subtle vertical seam + button to echo cardigan language */}
        <line x1="50" y1="56" x2="50" y2="82" stroke={OUTLINE} strokeWidth="0.8" opacity="0.35" />
        <circle cx="50" cy="68" r="1.8" fill={CREAM_SOFT} stroke={OUTLINE} strokeWidth="1.2" />
      </g>
    </Frame>
  );
}

function Moon({ size }) {
  return (
    <Frame size={size} bg="#2C474F">
      {/* Stars */}
      <g fill={CREAM_SOFT}>
        <path d="M 78 26 L 79.2 29 L 82.4 30 L 79.2 31 L 78 34 L 76.8 31 L 73.6 30 L 76.8 29 Z" />
        <path d="M 84 44 L 84.8 46 L 86.8 46.8 L 84.8 47.6 L 84 49.6 L 83.2 47.6 L 81.2 46.8 L 83.2 46 Z" />
      </g>
      {/* Crescent moon — big cream circle minus offset bite */}
      <path
        d="M 60 16
           A 22 22 0 1 0 60 60
           A 16 16 0 1 1 60 16 Z"
        fill={CREAM_SOFT}
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <Cardigan color={TEAL_DARK} />
    </Frame>
  );
}

function Heart({ size }) {
  return (
    <Frame size={size} bg="#EEE5D4">
      {/* Heart — soft lavender fill, outlined */}
      <path
        d="M 50 66
           C 30 54 20 42 24 30
           C 28 20 42 20 50 30
           C 58 20 72 20 76 30
           C 80 42 70 54 50 66 Z"
        fill="#DDD2E6"
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <Cardigan />
    </Frame>
  );
}

function Avocado({ size }) {
  return (
    <Frame size={size} bg="#D5DFE5">
      {/* Outer skin — pear-like silhouette */}
      <path
        d="M 50 14
           C 34 16 28 34 30 48
           C 30 60 38 68 50 68
           C 62 68 70 60 70 48
           C 72 34 66 16 50 14 Z"
        fill="#6B8B65"
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Flesh — lighter green interior */}
      <path
        d="M 50 20
           C 38 22 34 36 36 48
           C 36 58 42 64 50 64
           C 58 64 64 58 64 48
           C 66 36 62 22 50 20 Z"
        fill="#C6D6A8"
        stroke="none"
      />
      {/* Pit */}
      <circle cx="50" cy="42" r="7" fill="#8B5E3C" stroke={OUTLINE} strokeWidth="1.4" />
      <Cardigan />
    </Frame>
  );
}

function Sheep({ size }) {
  return (
    <Frame size={size} bg="#DFD7DF">
      {/* Fluffy wool — bumpy cloud silhouette */}
      <path
        d="M 24 48
           C 16 48 16 38 24 36
           C 24 28 34 26 40 30
           C 44 22 56 22 60 30
           C 66 26 76 28 76 36
           C 84 38 84 48 76 48
           C 76 56 66 58 60 56
           C 56 62 44 62 40 56
           C 34 58 24 56 24 48 Z"
        fill={CREAM_SOFT}
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Eyes */}
      <circle cx="42" cy="42" r="1.6" fill={OUTLINE} />
      <circle cx="58" cy="42" r="1.6" fill={OUTLINE} />
      <Cardigan />
    </Frame>
  );
}

function House({ size }) {
  return (
    <Frame size={size} bg="#D7E5DE">
      {/* Chimney */}
      <rect x="66" y="22" width="6" height="14" fill={TEAL_DARK} stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round" />
      {/* Roof */}
      <path
        d="M 18 48 L 50 20 L 82 48 Z"
        fill={TEAL}
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Body */}
      <rect x="24" y="46" width="52" height="30" fill={CREAM_SOFT} stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" />
      {/* Window — 4 pane teal */}
      <g stroke={OUTLINE} strokeWidth="1.4">
        <rect x="44" y="54" width="14" height="14" fill={TEAL_DARK} />
        <line x1="51" y1="54" x2="51" y2="68" stroke={CREAM_SOFT} strokeWidth="1.2" />
        <line x1="44" y1="61" x2="58" y2="61" stroke={CREAM_SOFT} strokeWidth="1.2" />
      </g>
      <Cardigan />
    </Frame>
  );
}

export {
  Dog,
  Cat,
  Plant,
  Coffee,
  Mountain,
  Cloud,
  Book,
  Moon,
  Heart,
  Avocado,
  Sheep,
  House,
};
