import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n/index";

/* ── SlashCommandMenu ──────────────────────────────────────────────
   Notion-style "/" inserter. Opens at the caret when the user types
   "/" at the start of an otherwise-empty line; offers one-tap
   insertion of every block format the editor renders.

   Intentionally minimal for v1:
     • No filter-as-you-type (typing more closes the menu — the user
       falls back to manual markdown). Filter mode adds a
       keystroke-watching state machine that's out of scope here;
       can come later when telemetry shows users want it.
     • No arrow-key navigation. Tap (or click) to select. Escape
       closes. Both work uniformly on phone, iPad, and desktop.
     • Renders via React portal anchored to document.body so the
       menu floats above the editor's clipping ancestors and
       doesn't interact with .mde-root's contenteditable.

   The trigger char "/" is left in the editor when the menu opens.
   Selection replaces the "/" with the chosen block syntax. Closing
   without selection leaves the "/" — the user can backspace it
   themselves; we don't second-guess their intent. */

// Inline SVG glyphs — same line-art family as FormatToolbar. Tiny so
// inlining doesn't pull from Icons.jsx (this menu is one-off enough
// not to warrant adding to the global icon set).
const G = (path: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);
const GlyphH1 = G(<><path d="M4 6v12M12 6v12M4 12h8" /><path d="M17 10l3-2v10" /></>);
const GlyphH2 = G(<><path d="M4 6v12M12 6v12M4 12h8" /><path d="M17 10c0-1.5 1-2 2.5-2s2.5 0.8 2.5 2.3c0 2.2-5 3.7-5 7.7h5" /></>);
const GlyphH3 = G(<><path d="M4 6v12M12 6v12M4 12h8" /><path d="M17 9c0-1 1-2 2.5-2s2.5 1 2.5 2-1 2-2.5 2c1.5 0 2.5 1 2.5 2.5s-1 2.5-2.5 2.5-2.5-1-2.5-2" /></>);
const GlyphUL = G(<><circle cx="5" cy="7" r="1.5" fill="currentColor" stroke="none" /><line x1="10" y1="7" x2="20" y2="7" /><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><line x1="10" y1="12" x2="20" y2="12" /><circle cx="5" cy="17" r="1.5" fill="currentColor" stroke="none" /><line x1="10" y1="17" x2="20" y2="17" /></>);
const GlyphOL = G(<><line x1="10" y1="7" x2="20" y2="7" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="17" x2="20" y2="17" /><text x="1" y="9" fontSize="7" fontWeight="700" fontFamily="Nunito, sans-serif" fill="currentColor" stroke="none">1</text><text x="1" y="14.5" fontSize="7" fontWeight="700" fontFamily="Nunito, sans-serif" fill="currentColor" stroke="none">2</text><text x="1" y="20" fontSize="7" fontWeight="700" fontFamily="Nunito, sans-serif" fill="currentColor" stroke="none">3</text></>);
const GlyphTask = G(<><rect x="3" y="4" width="6" height="6" rx="1.4" /><line x1="12" y1="7" x2="21" y2="7" /><rect x="3" y="14" width="6" height="6" rx="1.4" /><path d="M4.5 17l1.5 1.5 2.5-3" /><line x1="12" y1="17" x2="21" y2="17" /></>);

// `prefix` is what the chosen command inserts at line start (which
// the renderer will then tokenise as the matching block). Order in
// this list = order shown in the menu.
interface SlashCommand { key: string; labelKey: string; glyph: React.ReactNode; prefix: string; label?: string }

function getCommands(t: (key: string) => string): SlashCommand[] {
  return [
    { key: "h1",   labelKey: "notes.h1",        glyph: GlyphH1,   prefix: "# " },
    { key: "h2",   labelKey: "notes.h2",        glyph: GlyphH2,   prefix: "## " },
    { key: "h3",   labelKey: "notes.h3",        glyph: GlyphH3,   prefix: "### " },
    { key: "ul",   labelKey: "notes.bullet",    glyph: GlyphUL,   prefix: "- " },
    { key: "ol",   labelKey: "notes.numbered",  glyph: GlyphOL,   prefix: "1. " },
    { key: "task", labelKey: "notes.task",      glyph: GlyphTask, prefix: "[ ] " },
  ].map(c => ({ ...c, label: t(c.labelKey) }));
}

export function SlashCommandMenu({ open, anchorRect, onSelect, onClose }: {
  open?: boolean;
  anchorRect?: { top: number; bottom: number; left: number } | null;
  onSelect?: (command: SlashCommand) => void;
  onClose?: () => void;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const commands = getCommands(t);

  // Close on Escape; close on clicks outside the menu (the editor
  // itself counts as outside — selecting another line should
  // dismiss the menu rather than leave it floating).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose?.(); } };
    const onDocPointer = (e: Event) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose?.();
    };
    // Scroll-on-any-ancestor desyncs the popover from its anchor
    // rect (the menu is position:fixed, the rect was captured at
    // open time). Closing on first scroll keeps the visual
    // relationship honest — user can re-trigger "/" if they still
    // want the menu after scrolling.
    const onScroll = () => onClose?.();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("touchstart", onDocPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("touchstart", onDocPointer);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [open, onClose]);

  if (!open || !anchorRect) return null;

  // Positioning: prefer just below the anchor (the "/" line). If
  // that would push the menu past the viewport bottom, flip above.
  // Right-edge clamp keeps the menu inside the page; min-width
  // matches the typical context-menu width on macOS / iOS.
  const MENU_HEIGHT = 260;
  const MENU_WIDTH = 240;
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const wantBelow = anchorRect.bottom + MENU_HEIGHT + margin <= vh;
  const top = wantBelow
    ? anchorRect.bottom + margin
    : Math.max(margin, anchorRect.top - MENU_HEIGHT - margin);
  const left = Math.min(anchorRect.left, vw - MENU_WIDTH - margin);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t("notes.options")}
      className="slash-menu"
      style={{
        position: "fixed",
        top, left,
        width: MENU_WIDTH,
        zIndex: "var(--z-install)",
        animation: "slashMenuIn var(--dur-base) var(--ease-spring-soft)",
        fontFamily: "var(--font)",
      }}>
      {commands.map(c => {
        const Icon = c.glyph;
        return (
          <button
            key={c.key}
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()} /* keep focus in editor */
            onClick={() => onSelect?.(c)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              borderRadius: "var(--radius)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--charcoal)",
              fontFamily: "var(--font)",
              textAlign: "left",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--teal-mist)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28, height: 28,
              borderRadius: "var(--radius-sm)",
              background: "var(--cream)",
              color: "var(--charcoal-md)",
              flexShrink: 0,
            }}>
              {Icon}
            </span>
            <span>{c.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
