/* ── Cardigan preset avatars ────────────────────────────────────────
   12 hand-drawn illustrated avatars: each one is a subject (dog,
   cat, plant, coffee, mountain, cloud, book, moon, heart, avocado,
   sheep, house) wearing a teal cardigan. Soft pastel backgrounds
   vary per avatar — the only dark field is the moon, whose night
   sky is a deep navy-teal.

   Every avatar is 72×72 in the viewBox and scales cleanly to the
   consumer sizes (28/36/40/44/52/72/96 px). The shared <Frame>
   provides the circular backdrop; <Cardigan> draws the V-neck
   garment + button. Subjects compose these with their own paths. */

const OUTLINE = "#2E3E46";
const TEAL = "#5B9BAF";
const TEAL_DEEP = "#3E7585";
const CREAM = "#FAF3E8";
const WHITE = "#FFFFFF";

/* Shared <svg> wrapper — circular pastel field. */
function Frame({ size = 72, bg, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle cx="36" cy="36" r="36" fill={bg} />
      {children}
    </svg>
  );
}

/* The signature cardigan garment — a V-neck teal body with a single
   button at the bottom center. Every avatar (except the plant, which
   uses a knit-pot variant) composes one of these on top of its
   subject so the subject appears to "wear" the cardigan.

   The V opens from shoulders at (28, 42) and (44, 42) down to the
   center-V at (36, 58). Whatever subject is painted before this will
   show through the V; the rest of the cardigan occludes the lower
   half. */
function Cardigan({ color = TEAL, strokeW = 1.8 }) {
  return (
    <g stroke={OUTLINE} strokeWidth={strokeW} strokeLinejoin="round" strokeLinecap="round">
      <path
        d="M 4 72 L 4 48 Q 6 44 14 43 L 28 42 L 36 58 L 44 42 L 58 43 Q 66 44 68 48 L 68 72 Z"
        fill={color}
      />
      <line x1="36" y1="58" x2="36" y2="68" stroke={OUTLINE} strokeWidth="0.8" opacity="0.35" />
      <circle cx="36" cy="65" r="1.8" fill={WHITE} stroke={OUTLINE} strokeWidth="1.1" />
    </g>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SUBJECTS
   ═══════════════════════════════════════════════════════════════════ */

function Dog({ size }) {
  return (
    <Frame size={size} bg="#D1E5D8">
      {/* Ears */}
      <g fill={CREAM} stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round">
        <path d="M20 18 Q16 28 20 36 Q24 34 26 30 Q25 22 20 18 Z" />
        <path d="M52 18 Q56 28 52 36 Q48 34 46 30 Q47 22 52 18 Z" />
      </g>
      {/* Head */}
      <circle cx="36" cy="30" r="14" fill={CREAM} stroke={OUTLINE} strokeWidth="1.8" />
      {/* Eyes */}
      <g fill={OUTLINE}>
        <circle cx="30" cy="29" r="1.6" />
        <circle cx="42" cy="29" r="1.6" />
      </g>
      {/* Snout */}
      <ellipse cx="36" cy="36" rx="2.2" ry="1.6" fill={OUTLINE} />
      <path d="M36 38 Q36 40 34 40 M36 38 Q36 40 38 40"
        fill="none" stroke={OUTLINE} strokeWidth="1.2" strokeLinecap="round" />
      <Cardigan />
    </Frame>
  );
}

function Cat({ size }) {
  return (
    <Frame size={size} bg="#DCD3E7">
      {/* Ears (triangular) */}
      <g fill={WHITE} stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round">
        <path d="M22 20 L26 12 L30 22 Z" />
        <path d="M50 20 L46 12 L42 22 Z" />
      </g>
      {/* Head */}
      <circle cx="36" cy="30" r="14" fill={WHITE} stroke={OUTLINE} strokeWidth="1.8" />
      {/* Eyes */}
      <g fill={OUTLINE}>
        <circle cx="30" cy="29" r="1.3" />
        <circle cx="42" cy="29" r="1.3" />
      </g>
      {/* Nose + mouth */}
      <path d="M34.5 34 L36 36 L37.5 34 Z" fill={OUTLINE} />
      <path d="M36 36 L36 37.5 M34 38.5 Q35 39.5 36 37.5 Q37 39.5 38 38.5"
        fill="none" stroke={OUTLINE} strokeWidth="1.1" strokeLinecap="round" />
      {/* Whiskers */}
      <g stroke={OUTLINE} strokeWidth="0.9" strokeLinecap="round">
        <line x1="24" y1="33" x2="30" y2="34" />
        <line x1="24" y1="37" x2="30" y2="36" />
        <line x1="48" y1="33" x2="42" y2="34" />
        <line x1="48" y1="37" x2="42" y2="36" />
      </g>
      <Cardigan />
    </Frame>
  );
}

function Plant({ size }) {
  // Subject IS the cardigan — the pot wears a knit cardigan wrap.
  return (
    <Frame size={size} bg="#F2E8D5">
      {/* Stem */}
      <path d="M36 46 L36 28" stroke={OUTLINE} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      {/* Left leaf */}
      <path d="M36 30 Q26 24 22 16 Q32 18 36 28 Z"
        fill={TEAL} stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round" />
      {/* Right leaf */}
      <path d="M36 30 Q46 26 54 18 Q50 28 36 34 Z"
        fill={TEAL_DEEP} stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round" />
      {/* Small top leaf */}
      <path d="M36 28 Q38 22 42 22 Q38 28 36 30 Z"
        fill={TEAL} stroke={OUTLINE} strokeWidth="1.4" strokeLinejoin="round" />
      {/* Pot — cream cardigan-wrapped */}
      <g stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M 12 72 L 14 48 Q 16 44 24 44 L 36 56 L 48 44 Q 56 44 58 48 L 60 72 Z"
          fill={CREAM}
        />
        {/* Knit stitch hints */}
        <g stroke={OUTLINE} strokeWidth="0.6" opacity="0.35">
          <line x1="18" y1="54" x2="24" y2="54" />
          <line x1="48" y1="54" x2="54" y2="54" />
          <line x1="18" y1="60" x2="24" y2="60" />
          <line x1="48" y1="60" x2="54" y2="60" />
          <line x1="18" y1="66" x2="24" y2="66" />
          <line x1="48" y1="66" x2="54" y2="66" />
        </g>
        <circle cx="36" cy="65" r="1.8" fill={WHITE} stroke={OUTLINE} strokeWidth="1.1" />
      </g>
    </Frame>
  );
}

function Coffee({ size }) {
  return (
    <Frame size={size} bg="#D8E2E8">
      {/* Steam wisps */}
      <g fill="none" stroke={OUTLINE} strokeWidth="1.4" strokeLinecap="round">
        <path d="M30 10 Q28 14 30 18 Q32 22 30 26" />
        <path d="M38 12 Q36 16 38 20 Q40 24 38 28" />
      </g>
      {/* Mug body */}
      <g stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round">
        <path d="M20 30 L22 44 Q22 50 28 50 L44 50 Q50 50 50 44 L52 30 Z"
          fill={WHITE} />
        {/* Handle */}
        <path d="M50 34 Q58 34 58 40 Q58 46 50 46"
          fill="none" strokeLinecap="round" />
        {/* Coffee surface ellipse */}
        <ellipse cx="36" cy="30" rx="16" ry="3" fill="#8B6A4A" />
      </g>
      <Cardigan />
    </Frame>
  );
}

function Mountain({ size }) {
  return (
    <Frame size={size} bg="#D5CAE0">
      {/* Small cloud */}
      <g fill={WHITE} stroke={OUTLINE} strokeWidth="1.2" strokeLinejoin="round">
        <path d="M46 18 Q44 14 48 14 Q50 10 54 14 Q58 14 56 18 Z" />
      </g>
      {/* Back peak */}
      <path d="M20 46 L34 22 L46 38 Z"
        fill={TEAL_DEEP} stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" />
      {/* Front peak */}
      <path d="M12 48 L26 28 L40 48 Z"
        fill={TEAL} stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" />
      {/* Snow cap on front peak */}
      <path d="M22 32 L26 28 L30 32 Q28 34 26 34 Q24 34 22 32 Z"
        fill={WHITE} stroke={OUTLINE} strokeWidth="1.2" strokeLinejoin="round" />
      <Cardigan />
    </Frame>
  );
}

function Cloud({ size }) {
  return (
    <Frame size={size} bg="#D8EAE0">
      {/* Fluffy cloud */}
      <g fill={WHITE} stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round">
        <path d="M 18 40
                 Q 14 40 14 34
                 Q 14 28 20 28
                 Q 22 22 30 22
                 Q 36 18 42 22
                 Q 50 22 52 28
                 Q 58 28 58 34
                 Q 58 40 52 40
                 Z" />
      </g>
      <Cardigan />
    </Frame>
  );
}

function Book({ size }) {
  return (
    <Frame size={size} bg="#F4ECD9">
      {/* Book — teal cover, standing */}
      <g stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round">
        <rect x="22" y="14" width="28" height="34" rx="2" fill={TEAL} />
        {/* Spine */}
        <line x1="22" y1="14" x2="22" y2="48" strokeWidth="2.2" />
        {/* Pages edge */}
        <line x1="50" y1="16" x2="50" y2="46" stroke={CREAM} strokeWidth="2" />
        {/* Bookmark / detail */}
        <path d="M40 14 L40 24 L44 22 L48 24 L48 14" fill={CREAM} strokeWidth="1.4" />
      </g>
      <Cardigan />
    </Frame>
  );
}

function Moon({ size }) {
  return (
    <Frame size={size} bg="#2F4752">
      {/* Stars */}
      <g fill={CREAM}>
        <path d="M22 20 L23 22 L25 22 L23.5 23.5 L24 26 L22 24.5 L20 26 L20.5 23.5 L19 22 L21 22 Z" />
        <path d="M54 28 L54.8 29.6 L56.4 29.6 L55.2 30.8 L55.6 32.4 L54 31.4 L52.4 32.4 L52.8 30.8 L51.6 29.6 L53.2 29.6 Z" />
        <circle cx="18" cy="34" r="0.8" />
      </g>
      {/* Crescent moon */}
      <path
        d="M 48 16 A 16 16 0 1 0 48 48 A 12 12 0 1 1 48 16 Z"
        fill={CREAM}
        stroke={OUTLINE}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <Cardigan />
    </Frame>
  );
}

function Heart({ size }) {
  return (
    <Frame size={size} bg="#F0E8DC">
      {/* Heart outline — soft cream/lavender fill */}
      <path
        d="M36 46
           C 22 38 18 30 20 24
           C 22 18 30 18 36 26
           C 42 18 50 18 52 24
           C 54 30 50 38 36 46 Z"
        fill="#E5DDE5"
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
    <Frame size={size} bg="#D0DCE5">
      {/* Avocado half — pear-like outline */}
      <path
        d="M36 12
           Q26 14 24 26
           Q24 40 30 46
           Q36 50 42 46
           Q48 40 48 26
           Q46 14 36 12 Z"
        fill="#DCE8CE"
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Flesh ring (darker green interior) */}
      <path
        d="M36 16
           Q28 18 27 28
           Q27 40 32 44
           Q36 46 40 44
           Q45 40 45 28
           Q44 18 36 16 Z"
        fill="#B5CB94"
        stroke="none"
      />
      {/* Pit */}
      <circle cx="36" cy="32" r="5.5" fill="#8B6A4A" stroke={OUTLINE} strokeWidth="1.4" />
      <Cardigan />
    </Frame>
  );
}

function Sheep({ size }) {
  return (
    <Frame size={size} bg="#E5DDE5">
      {/* Fluffy wool — bumpy cloud-like shape */}
      <g fill={WHITE} stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round">
        <path d="M 18 32
                 Q 14 32 14 26
                 Q 14 20 20 20
                 Q 22 14 28 16
                 Q 34 12 40 16
                 Q 46 14 50 20
                 Q 56 20 56 26
                 Q 56 32 52 32
                 Q 52 38 46 38
                 Q 42 42 36 42
                 Q 28 42 24 38
                 Q 18 38 18 32 Z" />
      </g>
      {/* Eyes */}
      <g fill={OUTLINE}>
        <circle cx="30" cy="30" r="1.3" />
        <circle cx="42" cy="30" r="1.3" />
      </g>
      <Cardigan />
    </Frame>
  );
}

function House({ size }) {
  return (
    <Frame size={size} bg="#D5E5DF">
      {/* Chimney */}
      <rect x="44" y="14" width="5" height="8" fill={TEAL_DEEP} stroke={OUTLINE} strokeWidth="1.4" />
      {/* Roof */}
      <path d="M14 30 L36 14 L58 30 Z"
        fill={TEAL} stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" />
      {/* House body */}
      <rect x="20" y="28" width="32" height="20" fill={CREAM}
        stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" />
      {/* Windows */}
      <g fill={TEAL_DEEP} stroke={OUTLINE} strokeWidth="1.2">
        <rect x="26" y="34" width="7" height="7" />
        <rect x="39" y="34" width="7" height="7" />
        <line x1="29.5" y1="34" x2="29.5" y2="41" strokeWidth="0.8" stroke={CREAM} />
        <line x1="26" y1="37.5" x2="33" y2="37.5" strokeWidth="0.8" stroke={CREAM} />
        <line x1="42.5" y1="34" x2="42.5" y2="41" strokeWidth="0.8" stroke={CREAM} />
        <line x1="39" y1="37.5" x2="46" y2="37.5" strokeWidth="0.8" stroke={CREAM} />
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
