import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { IconStar, IconTrash, IconEdit, IconCheck, IconDocument, IconClipboard, IconUser, IconDownload, IconSearch } from "./Icons";

const IconSearchMenu = () => <IconSearch size={15} />;
import { useT } from "../i18n/index";
import { useCardigan } from "../context/CardiganContext";
import { useLayer } from "../hooks/useLayer";
import { useNoteTemplates } from "../hooks/useNoteTemplates";
import { MarkdownEditor } from "./notes/MarkdownEditor";
import { FormatToolbar } from "./notes/FormatToolbar";
import { NoteContextChip } from "./notes/NoteContextChip";
import { FindInNote } from "./notes/FindInNote";
import { NoteOutline } from "./notes/NoteOutline";
import { extractOutline } from "./notes/outlineUtil";
import { toPlainText } from "./notes/markdownModel";
import { haptic } from "../utils/haptics";
import { useViewport } from "../hooks/useViewport";
import { formatDate } from "../utils/format";

const TEMPLATE_ICONS = { edit: IconEdit, clipboard: IconClipboard, document: IconDocument, check: IconCheck, user: IconUser };

function relativeTime(dateStr, t) {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("timeNow");
  if (mins < 60) return t("timeMinutesAgo", { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("timeHoursAgo", { count: hrs });
  const days = Math.floor(hrs / 24);
  if (days === 1) return t("timeYesterday");
  if (days < 7) return t("timeDaysAgo", { count: days });
  return formatDate(dateStr, "short");
}

/* ── Empty-note detection ──
   A note is "effectively empty" when:
   - Both title and body are whitespace-only, OR
   - Content matches a pristine template.
   On close we silently delete those instead of persisting clutter. */
function isEffectivelyEmpty(title, content, templates) {
  const t = (title || "").trim();
  const c = (content || "").trim();
  if (!t && !c) return true;
  for (const tpl of templates) {
    if (tpl.id === "blank") continue;
    if (t === (tpl.title || "").trim() && c === (tpl.content || "").trim()) return true;
  }
  return false;
}

/* ── Main Editor shell ───────────────────────────────────────────────
   Thin wrapper around MarkdownEditor. Owns: header, save/delete/menu
   buttons, title input, template chooser, autosave, close flow,
   patient/session linking plumbing. Editing logic lives in
   MarkdownEditor. */
export function NoteEditor({ note, onSave, onDelete, onClose, layout = "overlay" }) {
  const inlineMode = layout === "inline";
  const { t } = useT();
  const { patients, upcomingSessions, togglePinNote, updateNoteLink, readOnly, showToast } = useCardigan();
  const noteTemplates = useNoteTemplates();
  const { isDesktop } = useViewport();
  const [pinned, setPinned] = useState(!!note?.pinned);
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [linkedPatientId, setLinkedPatientId] = useState(note?.patient_id || "");
  const [linkedSessionId, setLinkedSessionId] = useState(note?.session_id || "");
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving" | "dirty"
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeFormats, setActiveFormats] = useState(new Set());
  const [exiting, setExiting] = useState(false);
  const [toast, setToast] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const saveTimer = useRef(null);
  const toastTimer = useRef(null);
  const scrollRef = useRef(null);
  const editorRef = useRef(null);
  // Holds the latest typed args while a debounced save is pending. We
  // read this on unmount so a tablet-split-view note switch (which
  // unmounts the editor without going through doClose) doesn't drop
  // the user's last 800 ms of typing.
  const pendingSaveArgs = useRef(null);

  // Always close through this ref so "empty on close" → delete fires
  // regardless of what triggered the close (back button, ESC, etc.).
  // Synced via effect (not during render) to satisfy the React rules.
  const closeRef = useRef({ title, content, onSave, onDelete, onClose, note, readOnly, templates: noteTemplates });
  useEffect(() => {
    closeRef.current = { title, content, onSave, onDelete, onClose, note, readOnly, templates: noteTemplates };
  });

  const doClose = useCallback(async () => {
    const { title: ti, content: co, onSave: s, onDelete: d, onClose: cl, note: n, readOnly: ro, templates: tpls } = closeRef.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // doClose explicitly persists below, so unmount-flush would double-write.
    pendingSaveArgs.current = null;
    if (ro) { cl(); return; }
    try {
      if (isEffectivelyEmpty(ti, co, tpls)) {
        if (n?.id && d) await d();
      } else {
        await s({ title: ti, content: co });
      }
    } catch {
      // Surface the failure before closing — better to leave the user
      // with a visible error toast than to silently drop their writes.
      showToast?.(t("notes.saveFailed"), "error");
    }
    cl();
  }, [showToast, t]);

  const exitTimer = useRef(null);
  // Cancel the exit-animation timer on unmount so a queued doClose()
  // can't fire against a detached editor (e.g. user navigates away
  // mid-exit-animation).
  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);
  const handleClose = useCallback(() => {
    if (inlineMode) { doClose(); return; }
    // Mobile: run exit animation then close. Track the timer so a
    // double-close (e.g. swipe-to-dismiss + Escape) doesn't queue
    // two doClose() calls.
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setExiting(true);
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      doClose();
    }, 240);
  }, [doClose, inlineMode]);

  useLayer(inlineMode ? null : "noteEditor", inlineMode ? null : handleClose);

  /* ── Autosave ───────────────────────────────────────────────────── */
  const autoSave = useCallback((newTitle, newContent) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSaveArgs.current = { title: newTitle, content: newContent };
    setSaveState("dirty");
    saveTimer.current = setTimeout(async () => {
      pendingSaveArgs.current = null;
      setSaveState("saving");
      try {
        await onSave({ title: newTitle, content: newContent });
        setSaveState("saved");
        haptic.success();
      } catch {
        // Don't just flip back to "dirty" silently — the user thinks
        // their writes are queued but autosave is broken. Toast it
        // and leave the indicator showing dirty so they know to retry.
        // Re-arm pendingSaveArgs so unmount can still attempt to
        // persist what the user typed.
        pendingSaveArgs.current = { title: newTitle, content: newContent };
        setSaveState("dirty");
        haptic.warn();
        showToast?.(t("notes.saveFailed"), "error");
      }
    }, 800);
  }, [onSave, showToast, t]);

  // Flush any pending typed content on unmount. Without this, switching
  // notes on tablet split view (where the parent swaps `editingNote`
  // mid-debounce) silently dropped whatever the user typed in the last
  // 800 ms. Fire-and-forget; if it fails the user still has the toast
  // path on next mount via the dirty indicator.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const pending = pendingSaveArgs.current;
    if (pending && !closeRef.current?.readOnly) {
      pendingSaveArgs.current = null;
      const fn = closeRef.current?.onSave;
      if (fn) {
        try { Promise.resolve(fn(pending)).catch(() => {}); } catch { /* ignore */ }
      }
    }
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const handleTitleChange = (e) => {
    setTitle(e.target.value);
    autoSave(e.target.value, content);
  };

  const handleTitleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editorRef.current?.focus();
    }
  };

  const handleContentChange = useCallback((newContent) => {
    setContent(newContent);
    autoSave(title, newContent);
  }, [autoSave, title]);

  const handleSelectionChange = useCallback(({ active }) => {
    setActiveFormats(active || new Set());
  }, []);

  /* ── Scroll-shadow header ──────────────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 2);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  /* ── Link change ───────────────────────────────────────────────── */
  const handleLinkChange = async ({ patientId, sessionId }) => {
    setLinkedPatientId(patientId || "");
    setLinkedSessionId(sessionId || "");
    if (note?.id) await updateNoteLink(note.id, { patientId, sessionId });
  };

  /* ── Format buttons ────────────────────────────────────────────── */
  const onInlineFormat = (kind) => editorRef.current?.applyInlineFormat(kind);
  const onBlockFormat = (block) => editorRef.current?.applyBlockFormat(block);

  /* ── Find + outline ────────────────────────────────────────────── */
  const handleJumpToMatch = useCallback((match) => {
    editorRef.current?.jumpTo(match);
  }, []);
  const handleJumpToLine = useCallback((line) => {
    editorRef.current?.jumpTo({ line, startCol: 0, endCol: 0 });
    if (!isDesktop) setOutlineOpen(false);
  }, [isDesktop]);
  const hasHeadings = useMemo(() => extractOutline(content).length > 0, [content]);

  /* ── Template pick — only for brand-new empty notes ────────────── */
  const pickTemplate = (tpl) => {
    setTitle(tpl.title);
    setContent(tpl.content);
    editorRef.current?.setContent(tpl.content);
    autoSave(tpl.title, tpl.content);
    editorRef.current?.focus();
    haptic.tap();
  };

  /* ── Export/copy menu ──────────────────────────────────────────── */
  const flashToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  };
  const copyPlain = async () => {
    try {
      const body = toPlainText(content);
      const text = title ? `${title}\n\n${body}` : body;
      await navigator.clipboard.writeText(text);
      flashToast(t("notes.copied"));
      haptic.success();
    } catch {
      haptic.warn();
      showToast?.(t("notes.copyFailed"), "error");
    }
    setMenuOpen(false);
  };
  const copyMarkdown = async () => {
    try {
      const text = title ? `# ${title}\n\n${content}` : content;
      await navigator.clipboard.writeText(text);
      flashToast(t("notes.copied"));
      haptic.success();
    } catch {
      haptic.warn();
      showToast?.(t("notes.copyFailed"), "error");
    }
    setMenuOpen(false);
  };
  const exportMd = () => {
    try {
      const text = title ? `# ${title}\n\n${content}` : content;
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeTitle = (title || "nota").replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 60) || "nota";
      a.download = `${safeTitle}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      haptic.success();
    } catch {
      haptic.warn();
      showToast?.(t("notes.exportFailed"), "error");
    }
    setMenuOpen(false);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (!e.target.closest(".mde-menu") && !e.target.closest("[data-menu-trigger]")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [menuOpen]);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readingMins = wordCount > 0 ? Math.max(1, Math.round(wordCount / 200)) : 0;

  const dateStr = note?.updated_at
    ? formatDate(note.updated_at, "longTime")
    : "";

  const isBrandNewEmpty = !title && !content && !note?.title && !note?.content;

  const shellClass =
    (inlineMode ? "note-editor-inline" : "note-editor-desktop") +
    (!inlineMode ? (exiting ? " note-editor-exit" : " note-editor-enter") : "");

  const shellStyle = inlineMode
    ? { flex: 1, minHeight: 0, background: "var(--white)", display: "flex", flexDirection: "column" }
    : { position: "fixed", inset: 0, background: "var(--white)", zIndex: "var(--z-note-editor)", display: "flex", flexDirection: "column" };

  return (
    <div className={shellClass} style={shellStyle}>
      {/* ── Header ────────────────────────────────────────────── */}
      <div className={"mde-header" + (scrolled ? " is-scrolled" : "")}>
        <button className="mde-back" onClick={handleClose}>‹ {t("back")}</button>
        <div className="mde-header-actions">
          {!readOnly && (
            <span className={"mde-save-indicator " + (saveState === "saved" ? "is-saved" : "is-saving")}>
              {saveState === "saved" ? t("notes.saved") : t("notes.saving")}
            </span>
          )}
          {hasHeadings && (
            <button
              className={"mde-icon-btn" + (outlineOpen ? " is-active" : "")}
              onClick={() => setOutlineOpen(v => !v)}
              aria-label={t("notes.outline")}
              aria-pressed={outlineOpen ? "true" : "false"}
              title={t("notes.outline")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="8" y1="12" x2="20" y2="12" />
                <line x1="8" y1="17" x2="16" y2="17" />
              </svg>
            </button>
          )}
          {!readOnly && note?.id && (
            <button
              className={"mde-icon-btn" + (pinned ? " is-pinned" : "")}
              onClick={async () => { haptic.tap(); await togglePinNote(note.id); setPinned(p => !p); }}
              aria-label={t("favorite") || "Favorito"}
              aria-pressed={pinned ? "true" : "false"}
            >
              <IconStar size={16} />
            </button>
          )}
          {!readOnly && (
            <div style={{ position: "relative" }}>
              <button
                data-menu-trigger
                className="mde-icon-btn"
                onClick={() => setMenuOpen(v => !v)}
                aria-label={t("notes.options") || "Opciones"}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
                </svg>
              </button>
              {menuOpen && (
                <div className="mde-menu" role="menu">
                  <button className="mde-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setFindOpen(true); }}>
                    <IconSearchMenu />
                    <span>{t("notes.find.placeholder")}</span>
                  </button>
                  <div className="mde-menu-sep" />
                  <button className="mde-menu-item" role="menuitem" onClick={copyPlain}>
                    <IconClipboard size={15} />
                    <span>{t("notes.copyPlain")}</span>
                  </button>
                  <button className="mde-menu-item" role="menuitem" onClick={copyMarkdown}>
                    <IconEdit size={15} />
                    <span>{t("notes.copyMarkdown")}</span>
                  </button>
                  <button className="mde-menu-item" role="menuitem" onClick={exportMd}>
                    <IconDownload size={15} />
                    <span>{t("notes.exportMd")}</span>
                  </button>
                  {onDelete && (
                    <>
                      <div className="mde-menu-sep" />
                      <button className="mde-menu-item is-danger" role="menuitem" onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}>
                        <IconTrash size={15} />
                        <span>{t("delete")}</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Toolbar ────────────────────────────────────────────── */}
      {!readOnly && (
        <FormatToolbar
          active={activeFormats}
          onInline={onInlineFormat}
          onBlock={onBlockFormat}
        />
      )}

      {/* ── Find-in-note bar ───────────────────────────────────── */}
      {findOpen && !readOnly && (
        <FindInNote
          title={title}
          content={content}
          onJump={handleJumpToMatch}
          onClose={() => { setFindOpen(false); editorRef.current?.focus(); }}
        />
      )}

      {/* ── Context chip ───────────────────────────────────────── */}
      <div className="mde-context-row">
        <NoteContextChip
          patients={patients}
          sessions={upcomingSessions}
          patientId={linkedPatientId}
          sessionId={linkedSessionId}
          onChange={handleLinkChange}
          readOnly={readOnly}
        />
      </div>

      {/* ── Delete confirmation modal ─────────────────────────── */}
      {confirmDelete && (
        <div className="sheet-overlay" onClick={() => setConfirmDelete(false)} style={{ alignItems: "center" }}>
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
            style={{ maxWidth: 340, borderRadius: "var(--radius-lg)", margin: "0 20px", animation: "sheetScaleIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            <div style={{ padding: "28px 24px 22px", textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--red-bg)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <IconTrash size={24} />
              </div>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 18, fontWeight: 800, color: "var(--charcoal)", marginBottom: 6 }}>
                {t("notes.deleteConfirm")}
              </div>
              <div style={{ fontSize: 13, color: "var(--charcoal-lt)", lineHeight: 1.5, marginBottom: 20 }}>
                {t("notes.deleteWarning")}
              </div>
              <button className="btn btn-danger" onClick={async () => { haptic.warn(); await onDelete(); onClose(); }}>
                {t("delete")}
              </button>
              <button className="btn btn-secondary" style={{ marginTop: 8, width: "100%" }}
                onClick={() => setConfirmDelete(false)}>
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Body (title + markdown editor) ────────────────────── */}
      <div ref={scrollRef} className="mde-scroll">
        {dateStr && <div className="mde-date">{dateStr}</div>}

        {isBrandNewEmpty && !readOnly && (
          <div className="mde-templates">
            <div className="mde-templates-label">{t("notes.templates")}</div>
            <div className="mde-template-pills">
              {noteTemplates.filter(tp => tp.id !== "blank").map(tpl => {
                const Ic = TEMPLATE_ICONS[tpl.icon];
                return (
                  <button key={tpl.id} type="button" className="mde-template-pill" onClick={() => pickTemplate(tpl)}>
                    {Ic && <Ic size={14} />}
                    <span>{tpl.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <input
          type="text"
          className="mde-title"
          value={title}
          onChange={handleTitleChange}
          onKeyDown={handleTitleKeyDown}
          placeholder={t("notes.titlePlaceholder")}
          autoFocus={!readOnly && !note?.id}
          readOnly={readOnly}
          aria-label={t("notes.titlePlaceholder")}
        />

        <MarkdownEditor
          ref={editorRef}
          initialContent={content}
          readOnly={readOnly}
          onContentChange={handleContentChange}
          onSelectionChange={handleSelectionChange}
          onRequestFind={() => setFindOpen(true)}
          placeholder={t("notes.bodyPlaceholder")}
        />
      </div>

      {/* ── Footer (word count + reading time) ────────────────── */}
      <div className="mde-footer">
        <span className="mde-footer-left">
          {wordCount > 0 && readingMins > 0 ? t("notes.readingTime", { mins: readingMins }) : ""}
        </span>
        <span className="mde-footer-right">
          {t("notes.wordCountLabel", { count: wordCount, plural: wordCount === 1 ? "" : "s" })}
        </span>
      </div>

      {/* ── Outline drawer / sheet ──────────────────────────────── */}
      {outlineOpen && (
        <div className="sheet-overlay" onClick={() => setOutlineOpen(false)}>
          <div
            className="sheet-panel mde-outline-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("notes.outline")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-handle" />
            <NoteOutline
              content={content}
              onJump={(line) => { setOutlineOpen(false); handleJumpToLine(line); }}
              variant={isDesktop ? "drawer" : "sheet"}
            />
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", left: "50%", bottom: "calc(var(--sab, 0px) + 70px)",
          transform: "translateX(-50%)", background: "var(--charcoal)", color: "var(--white)",
          padding: "10px 16px", borderRadius: "var(--radius-pill)", fontSize: 12, fontWeight: 600,
          zIndex: "var(--z-sheet)", boxShadow: "var(--shadow-lg)",
          animation: "toastIn 0.5s ease",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

export function NoteCard({ note, onClick, patientName, sessionLabel, onPatientClick }) {
  const { t } = useT();
  const preview = note.content?.replace(/[*~#`[\]]/g, "").replace(/\n/g, " ").slice(0, 100) || t("notes.noContent");
  const timeAgo = relativeTime(note.updated_at, t);
  const hasLink = patientName || sessionLabel;
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      style={{ padding: "12px 16px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        {note.pinned && <IconStar size={11} style={{ color: "var(--amber)", flexShrink: 0 }} />}
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--charcoal)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
          {note.title || t("notes.noTitle")}
        </div>
        <span style={{ fontSize: 11, color: "var(--charcoal-xl)", flexShrink: 0, fontWeight: 500 }}>{timeAgo}</span>
      </div>
      <div style={{ fontSize: 12, color: hasLink ? "var(--teal-dark)" : "var(--charcoal-lt)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: hasLink ? 600 : 400 }}>
        {hasLink
          ? <>
              {patientName && <span onClick={onPatientClick ? (e) => { e.stopPropagation(); onPatientClick(); } : undefined}
                style={onPatientClick ? { cursor: "pointer", textDecoration: "underline", textDecorationColor: "var(--teal-light)", textUnderlineOffset: 2 } : undefined}>
                {t("sessions.patient")}: {patientName}
              </span>}
              {patientName && sessionLabel && " | "}
              {sessionLabel && `${t("sessions.session")}: ${sessionLabel}`}
            </>
          : preview}
      </div>
    </div>
  );
}
