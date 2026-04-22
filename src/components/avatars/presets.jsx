import React from "react";

/* ── Cardigan preset avatars ────────────────────────────────────────
   12 SVGs transcribed verbatim from the designer's spec. Only
   modification vs. the source: `width` / `height` / `aria-hidden` /
   `display:block` on the outer <svg> so the component composes
   inside our circular avatar containers at the rendered size.
   Every child element (paths, circles, colors, coordinates) is
   exactly as defined. */

const svgProps = (size) => ({
  width: size,
  height: size,
  viewBox: "0 0 100 100",
  "aria-hidden": "true",
  style: { display: "block" },
});

export const Dog = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#E8ECEB"/>
    <circle cx="50" cy="42" r="16" fill="#F4F4F4"/>
    <circle cx="42" cy="40" r="2" fill="#333"/>
    <circle cx="58" cy="40" r="2" fill="#333"/>
    <path d="M50 46 Q50 50 46 50" stroke="#333" fill="none"/>
    <path d="M34 55 L50 70 L66 55 Z" fill="#6FA3A8"/>
    <circle cx="50" cy="62" r="1.5" fill="#fff"/>
  </svg>
);

export const Cat = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#EAE7F2"/>
    <path d="M35 38 L45 28 L55 38 L65 28 L75 38" fill="#F4F4F4"/>
    <circle cx="42" cy="42" r="2" fill="#333"/>
    <circle cx="58" cy="42" r="2" fill="#333"/>
    <path d="M50 48 Q50 50 48 50" stroke="#333" fill="none"/>
    <path d="M34 55 L50 70 L66 55 Z" fill="#6FA3A8"/>
  </svg>
);

export const Plant = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#EFE8DD"/>
    <rect x="35" y="50" width="30" height="20" fill="#6FA3A8"/>
    <path d="M50 30 Q40 45 50 50 Q60 45 50 30" fill="#7FB38A"/>
    <path d="M34 55 L50 70 L66 55 Z" fill="#E6E1D8"/>
  </svg>
);

export const Coffee = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#E3E7EB"/>
    <rect x="30" y="40" width="40" height="25" rx="5" fill="#F4F4F4"/>
    <path d="M70 45 Q80 50 70 55" stroke="#333" fill="none"/>
    <path d="M35 65 L50 80 L65 65 Z" fill="#6FA3A8"/>
  </svg>
);

export const Mountain = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#E9E9EF"/>
    <path d="M30 65 L50 35 L70 65 Z" fill="#6FA3A8"/>
    <path d="M45 45 L50 35 L55 45 Z" fill="#fff"/>
    <path d="M34 70 L50 85 L66 70 Z" fill="#6FA3A8"/>
  </svg>
);

export const Abstract = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#E6ECEB"/>
    <circle cx="50" cy="40" r="12" fill="#F4F4F4"/>
    <path d="M34 60 L50 75 L66 60 Z" fill="#6FA3A8"/>
  </svg>
);

export const Book = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#EFE8DD"/>
    <rect x="35" y="35" width="30" height="30" rx="3" fill="#6FA3A8"/>
    <line x1="50" y1="35" x2="50" y2="65" stroke="#fff"/>
  </svg>
);

export const Moon = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#2F4F54"/>
    <path d="M55 30 A20 20 0 1 0 55 70 A15 15 0 1 1 55 30" fill="#F4F4F4"/>
    <path d="M34 70 L50 85 L66 70 Z" fill="#6FA3A8"/>
  </svg>
);

export const Heart = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#EFE8DD"/>
    <path d="M50 70 L30 50 Q30 35 45 35 Q50 40 50 40 Q50 40 55 35 Q70 35 70 50 Z" fill="#D9CFE3"/>
    <path d="M34 70 L50 85 L66 70 Z" fill="#6FA3A8"/>
  </svg>
);

export const Avocado = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#E6ECEB"/>
    <ellipse cx="50" cy="50" rx="20" ry="25" fill="#A7C4A0"/>
    <circle cx="50" cy="55" r="6" fill="#8B5A2B"/>
    <path d="M34 70 L50 85 L66 70 Z" fill="#6FA3A8"/>
  </svg>
);

export const Cloud = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#EAE7F2"/>
    <circle cx="45" cy="50" r="10" fill="#F4F4F4"/>
    <circle cx="55" cy="50" r="10" fill="#F4F4F4"/>
    <rect x="40" y="50" width="20" height="10" fill="#F4F4F4"/>
    <path d="M34 70 L50 85 L66 70 Z" fill="#6FA3A8"/>
  </svg>
);

export const House = ({ size = 72 }) => (
  <svg {...svgProps(size)}>
    <circle cx="50" cy="50" r="48" fill="#E6ECEB"/>
    <path d="M30 50 L50 35 L70 50 V70 H30 Z" fill="#F4F4F4"/>
    <rect x="45" y="60" width="10" height="10" fill="#6FA3A8"/>
    <path d="M34 70 L50 85 L66 70 Z" fill="#6FA3A8"/>
  </svg>
);
