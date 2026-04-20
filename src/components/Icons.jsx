/*
 * Clean, thin-line SVG icons matching Cardigan brand aesthetic.
 * All icons use currentColor so they inherit text color from context.
 */

const I = ({ children, size = 20, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {children}
  </svg>
);

export const IconHome = (p) => (
  <I {...p}><path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1H4a1 1 0 01-1-1V10.5z"/><path d="M9 22V12h6v10"/></I>
);

export const IconCalendar = (p) => (
  <I {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></I>
);

export const IconUser = (p) => (
  <I {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0112 0v1"/></I>
);

export const IconUsers = (p) => (
  <I {...p}>
    {/* Two back silhouettes: heads up top, shoulders peeking from the sides */}
    <circle cx="7" cy="7" r="2.5"/>
    <circle cx="17" cy="7" r="2.5"/>
    <path d="M2 14.5a5 5 0 014.5-4.5"/>
    <path d="M22 14.5a5 5 0 00-4.5-4.5"/>
    {/* Full front silhouette — larger, centered, slightly lower */}
    <circle cx="12" cy="10" r="3.5"/>
    <path d="M5 21v-1a7 7 0 0114 0v1"/>
  </I>
);

export const IconDollar = (p) => (
  <I {...p}><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></I>
);

export const IconCreditCard = (p) => (
  <I {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></I>
);

export const IconSettings = (p) => (
  <I {...p}>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </I>
);

export const IconSearch = (p) => (
  <I {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></I>
);

export const IconBell = (p) => (
  <I {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></I>
);

export const IconStar = (p) => (
  <I {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/></I>
);

export const IconClipboard = (p) => (
  <I {...p}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></I>
);

export const IconKey = (p) => (
  <I {...p}><circle cx="8" cy="15" r="5"/><path d="M12.6 11.4L17 7M15 9l2-2M21 3l-4 4"/></I>
);

export const IconLogOut = (p) => (
  <I {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></I>
);

export const IconCash = (p) => (
  <I {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M2 10h2M20 10h2M2 14h2M20 14h2"/></I>
);

export const IconBank = (p) => (
  <I {...p}><path d="M3 21h18M3 10h18M5 6l7-3 7 3"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/></I>
);

export const IconEdit = (p) => (
  <I {...p}><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></I>
);

export const IconCheck = (p) => (
  <I {...p}><path d="M20 6L9 17l-5-5"/></I>
);

export const IconX = (p) => (
  <I {...p}><path d="M18 6L6 18M6 6l12 12"/></I>
);

export const IconLeaf = (p) => (
  <I {...p}>
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96a1 1 0 0 1 1.8.5c.5 4-1.5 12-9 19a1 1 0 0 1-1.7-.4"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6"/>
  </I>
);

export const IconPlus = (p) => (
  <I {...p}><path d="M12 5v14M5 12h14"/></I>
);

export const IconUserPlus = (p) => (
  <I {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0116 0v1"/></I>
);

export const IconCalendarPlus = (p) => (
  <I {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"/></I>
);

export const IconCurrency = (p) => (
  <I {...p}><circle cx="12" cy="12" r="9"/><path d="M14.5 9h-3a2 2 0 000 4h1a2 2 0 010 4H9.5M12 6.5V9M12 17v-2"/></I>
);

export const IconChevron = (p) => (
  <I size={16} {...p}><path d="M9 18l6-6-6-6"/></I>
);

export const IconSun = (p) => (
  <I {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></I>
);

export const IconMoon = (p) => (
  <I {...p}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></I>
);

export const IconSmartphone = (p) => (
  <I {...p}><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></I>
);

export const IconPhone = (p) => (
  <I {...p}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></I>
);

export const IconMail = (p) => (
  <I {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></I>
);

export const IconDocument = (p) => (
  <I {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></I>
);

export const IconUpload = (p) => (
  <I {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></I>
);

export const IconDownload = (p) => (
  <I {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></I>
);

export const IconTrash = (p) => (
  <I {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></I>
);

export const IconFilter = (p) => (
  <I {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></I>
);

export const IconTag = (p) => (
  <I {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1" fill="currentColor"/></I>
);

export const IconBug = (p) => (
  <I {...p}><path d="M8 2l1.88 1.88M16 2l-1.88 1.88"/><path d="M9 7.13v-1a3.003 3.003 0 116 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a6 6 0 0112 0v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M17.47 9c1.93-.2 3.53-1.9 3.53-4"/><path d="M18 13h4"/><path d="M21 21c0-2.1-1.7-3.9-3.8-4"/></I>
);

export const IconRefresh = (p) => (
  <I {...p}><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0115.36-6.36L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 01-15.36 6.36L3 16"/></I>
);
export const IconTrendingUp = (p) => (
  <I {...p}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></I>
);

// Brand icons for OAuth buttons. Rendered with their real colors (not
// currentColor) because the Google "G" is multi-color by guideline and
// the Apple logo is a solid filled shape.
export const IconGoogle = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

export const IconApple = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <path d="M16.365 1.43c0 1.14-.45 2.22-1.17 3-.74.81-1.93 1.43-3.07 1.35-.12-1.12.44-2.26 1.15-3.01.78-.84 2.09-1.46 3.09-1.34zM20.5 17.36c-.57 1.26-.84 1.82-1.57 2.93-1.01 1.55-2.44 3.48-4.21 3.5-1.58.02-1.98-1.03-4.12-1.02-2.14.01-2.58 1.03-4.16 1.01-1.77-.02-3.12-1.76-4.13-3.31C-.55 16.77-.81 10.71 2.2 7.63c1.07-1.1 2.54-1.8 4.03-1.8 1.55 0 2.53.85 3.81.85 1.24 0 2-.85 3.79-.85 1.34 0 2.77.73 3.78 1.99-3.32 1.82-2.78 6.56.89 7.54z"/>
  </svg>
);
