import React from "react";

/* ── Cardigan preset avatars ────────────────────────────────────────
   12 SVGs transcribed verbatim from the designer's spec. Each
   subject is drawn around (0, 0) in a 100×100 viewBox centered
   on the origin — exactly matching the coordinate space in the
   source file. Only additions on the outer <svg>: width / height
   (driven by size) and the aria-hidden / display:block props
   our circular containers need. */

const svgProps = (size) => ({
  width: size,
  height: size,
  viewBox: "-50 -50 100 100",
  "aria-hidden": "true",
  style: { display: "block" },
});

const BG = "#ECEFF1";
const PRIMARY = "#6FA3A8";
const ACCENT = "#F4F4F4";
const LINE = "#2F3E46";

export const Dog = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <circle cx="0" cy="-8" r="16" fill={ACCENT}/>
    <circle cx="-6" cy="-10" r="2"/>
    <circle cx="6" cy="-10" r="2"/>
    <path d="M0 -4 Q0 0 -4 0" stroke={LINE} strokeWidth="2" fill="none" strokeLinecap="round"/>
    <path d="M-18 14 L0 32 L18 14 Z" fill={PRIMARY}/>
    <circle cx="0" cy="22" r="1.5" fill="#fff"/>
  </svg>
);

export const Cat = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <path d="M-18 -10 L-8 -22 L0 -10 L8 -22 L18 -10 Z" fill={ACCENT}/>
    <circle cx="-6" cy="-6" r="2"/>
    <circle cx="6" cy="-6" r="2"/>
    <path d="M0 0 Q0 2 -2 2" stroke={LINE} strokeWidth="2" fill="none" strokeLinecap="round"/>
    <path d="M-18 14 L0 32 L18 14 Z" fill={PRIMARY}/>
  </svg>
);

export const Plant = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <rect x="-14" y="4" width="28" height="16" fill={PRIMARY}/>
    <path d="M0 -22 Q-10 -4 0 0 Q10 -4 0 -22" fill="#7FB38A"/>
    <path d="M-18 14 L0 32 L18 14 Z" fill="#E0DED8"/>
  </svg>
);

export const Coffee = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <rect x="-18" y="-10" width="36" height="22" rx="6" fill={ACCENT}/>
    <path d="M18 -4 Q26 0 18 4" stroke={LINE} strokeWidth="2" fill="none" strokeLinecap="round"/>
    <path d="M-16 14 L0 32 L16 14 Z" fill={PRIMARY}/>
  </svg>
);

export const Mountain = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <path d="M-22 16 L0 -16 L22 16 Z" fill={PRIMARY}/>
    <path d="M-6 -4 L0 -16 L6 -4 Z" fill="#fff"/>
    <path d="M-18 20 L0 34 L18 20 Z" fill={PRIMARY}/>
  </svg>
);

export const Abstract = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <circle cx="0" cy="-10" r="12" fill={ACCENT}/>
    <path d="M-18 14 L0 32 L18 14 Z" fill={PRIMARY}/>
  </svg>
);

export const Book = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <rect x="-14" y="-14" width="28" height="28" rx="4" fill={PRIMARY}/>
    <line x1="0" y1="-14" x2="0" y2="14" stroke="#fff"/>
  </svg>
);

export const Moon = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill="#2F4F54"/>
    <path d="M6 -20 A20 20 0 1 0 6 20 A14 14 0 1 1 6 -20" fill="#F4F4F4"/>
    <path d="M-18 20 L0 34 L18 20 Z" fill="#6FA3A8"/>
  </svg>
);

export const Heart = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <path d="M0 20 L-18 0 Q-18 -14 -4 -14 Q0 -10 0 -10 Q0 -10 4 -14 Q18 -14 18 0 Z" fill="#D9CFE3"/>
    <path d="M-18 20 L0 34 L18 20 Z" fill={PRIMARY}/>
  </svg>
);

export const Avocado = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <ellipse cx="0" cy="0" rx="18" ry="24" fill="#A7C4A0"/>
    <circle cx="0" cy="6" r="6" fill="#8B5A2B"/>
    <path d="M-18 20 L0 34 L18 20 Z" fill={PRIMARY}/>
  </svg>
);

export const Cloud = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <circle cx="-6" cy="0" r="10" fill={ACCENT}/>
    <circle cx="6" cy="0" r="10" fill={ACCENT}/>
    <rect x="-10" y="0" width="20" height="10" fill={ACCENT}/>
    <path d="M-18 20 L0 34 L18 20 Z" fill={PRIMARY}/>
  </svg>
);

export const House = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="0" cy="0" r="48" fill={BG}/>
    <path d="M-20 0 L0 -16 L20 0 V20 H-20 Z" fill={ACCENT}/>
    <rect x="-5" y="10" width="10" height="10" fill={PRIMARY}/>
    <path d="M-18 20 L0 34 L18 20 Z" fill={PRIMARY}/>
  </svg>
);
