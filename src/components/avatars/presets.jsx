/* ── Cardigan preset avatars ────────────────────────────────────────
   12 small line-art avatars, kept mostly untouched from the provided
   reference SVGs. Each one is drawn in a (-48, -48) → (48, 48)
   coordinate space matching the reference, with a 48-radius circular
   pastel background and a tiny teal "cardigan" triangle at the bottom
   as the unifying brand motif.

   Only adjustment from the reference: the teal accent color is driven
   by `var(--teal)` so the app's design-token palette (including any
   dark-mode override) applies automatically — everything else is
   untouched. */

const TEAL = "var(--teal)";
const DARK = "#333";
const WHITE = "#fff";
const OFFWHITE = "#F4F4F4";

function Frame({ size = 72, bg, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-48 -48 96 96"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle cx="0" cy="0" r="48" fill={bg} />
      {children}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SUBJECTS
   ═══════════════════════════════════════════════════════════════════ */

function Dog({ size }) {
  return (
    <Frame size={size} bg="#E8ECEB">
      <circle cx="0" cy="-8" r="16" fill={OFFWHITE} />
      <circle cx="-8" cy="-10" r="2" fill={DARK} />
      <circle cx="8" cy="-10" r="2" fill={DARK} />
      <path d="M0 -4 Q0 0 -4 0" stroke={DARK} fill="none" />
      <path d="M-16 15 L0 30 L16 15 Z" fill={TEAL} />
      <circle cx="0" cy="22" r="1.5" fill={WHITE} />
    </Frame>
  );
}

function Cat({ size }) {
  return (
    <Frame size={size} bg="#EAE7F2">
      <path d="M-15 -12 L-5 -22 L5 -12 L15 -22 L25 -12" fill={OFFWHITE} />
      <circle cx="-8" cy="-6" r="2" fill={DARK} />
      <circle cx="8" cy="-6" r="2" fill={DARK} />
      <path d="M0 0 Q0 2 -2 2" stroke={DARK} fill="none" />
      <path d="M-16 15 L0 30 L16 15 Z" fill={TEAL} />
    </Frame>
  );
}

function Plant({ size }) {
  return (
    <Frame size={size} bg="#EFE8DD">
      <rect x="-15" y="0" width="30" height="20" fill={TEAL} />
      <path d="M0 -20 Q-10 -5 0 0 Q10 -5 0 -20" fill="#7FB38A" />
      <path d="M-16 15 L0 30 L16 15 Z" fill="#E6E1D8" />
    </Frame>
  );
}

function Coffee({ size }) {
  return (
    <Frame size={size} bg="#E3E7EB">
      <rect x="-20" y="-10" width="40" height="25" rx="5" fill={OFFWHITE} />
      <path d="M20 -5 Q30 0 20 5" stroke={DARK} fill="none" />
      <path d="M-15 15 L0 30 L15 15 Z" fill={TEAL} />
    </Frame>
  );
}

function Mountain({ size }) {
  return (
    <Frame size={size} bg="#E9E9EF">
      <path d="M-20 15 L0 -15 L20 15 Z" fill={TEAL} />
      <path d="M-5 -5 L0 -15 L5 -5 Z" fill={WHITE} />
      <path d="M-16 20 L0 35 L16 20 Z" fill={TEAL} />
    </Frame>
  );
}

function Silueta({ size }) {
  return (
    <Frame size={size} bg="#E6ECEB">
      <circle cx="0" cy="-10" r="12" fill={OFFWHITE} />
      <path d="M-16 15 L0 30 L16 15 Z" fill={TEAL} />
    </Frame>
  );
}

function Book({ size }) {
  return (
    <Frame size={size} bg="#EFE8DD">
      <rect x="-15" y="-15" width="30" height="30" rx="3" fill={TEAL} />
      <line x1="0" y1="-15" x2="0" y2="15" stroke={WHITE} />
    </Frame>
  );
}

function Moon({ size }) {
  return (
    <Frame size={size} bg="#2F4F54">
      <path d="M5 -20 A20 20 0 1 0 5 20 A15 15 0 1 1 5 -20" fill={OFFWHITE} />
      <path d="M-16 20 L0 35 L16 20 Z" fill={TEAL} />
    </Frame>
  );
}

function Heart({ size }) {
  return (
    <Frame size={size} bg="#EFE8DD">
      <path
        d="M0 20 L-20 0 Q-20 -15 -5 -15 Q0 -10 0 -10 Q0 -10 5 -15 Q20 -15 20 0 Z"
        fill="#D9CFE3"
      />
      <path d="M-16 20 L0 35 L16 20 Z" fill={TEAL} />
    </Frame>
  );
}

function Avocado({ size }) {
  return (
    <Frame size={size} bg="#E6ECEB">
      <ellipse cx="0" cy="0" rx="20" ry="25" fill="#A7C4A0" />
      <circle cx="0" cy="5" r="6" fill="#8B5A2B" />
      <path d="M-16 20 L0 35 L16 20 Z" fill={TEAL} />
    </Frame>
  );
}

function Cloud({ size }) {
  return (
    <Frame size={size} bg="#EAE7F2">
      <circle cx="-5" cy="0" r="10" fill={OFFWHITE} />
      <circle cx="5" cy="0" r="10" fill={OFFWHITE} />
      <rect x="-10" y="0" width="20" height="10" fill={OFFWHITE} />
      <path d="M-16 20 L0 35 L16 20 Z" fill={TEAL} />
    </Frame>
  );
}

function House({ size }) {
  return (
    <Frame size={size} bg="#E6ECEB">
      <path d="M-20 0 L0 -15 L20 0 V20 H-20 Z" fill={OFFWHITE} />
      <rect x="-5" y="10" width="10" height="10" fill={TEAL} />
      <path d="M-16 20 L0 35 L16 20 Z" fill={TEAL} />
    </Frame>
  );
}

export {
  Dog,
  Cat,
  Plant,
  Coffee,
  Mountain,
  Silueta,
  Book,
  Moon,
  Heart,
  Avocado,
  Cloud,
  House,
};
