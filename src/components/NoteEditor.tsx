import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { IconStar, IconTrash, IconEdit, IconCheck, IconDocument, IconClipboard, IconUser, IconDownload, IconSearch } from "./Icons";

const IconSearchMenu = () => <IconSearch size={15} />;
import { useT } from "../i18n/index";
import { useCardiganMain } from "../context/CardiganContext";
import { useLayer } from "../hooks/useLayer";
import { useNoteTemplates } from "../hooks/useNoteTemplates";
import { MarkdownEditor } from "./notes/MarkdownEditor";
import type { MarkdownEditorHandle } from "./notes/MarkdownEditor";
import { captureMessage } from "../lib/sentry";
import { useAttachmentSrc } from "./notes/useAttachmentSrc";
import { CoverPickerSheet } from "./notes/CoverPickerSheet";
import { FormatToolbar } from "./notes/FormatToolbar";
import { NoteContextChip } from "./notes/NoteContextChip";
import { FindInNote } from "./notes/FindInNote";
import { NoteOutline } from "./notes/NoteOutline";
import { VersionHistorySheet } from "./notes/VersionHistorySheet";
import { AttachmentStrip } from "./notes/AttachmentStrip";
import { useVoiceDictation } from "../lib/useVoiceDictation";
import { supabase } from "../supabaseClient";
import { enqueue } from "../lib/mutationQueue";
import { extractOutline } from "./notes/outlineUtil";
import { useNoteOutline } from "./notes/useNoteOutline";
import { useNoteAutosave } from "./notes/useNoteAutosave";
import { toPlainText } from "./notes/markdownModel";
import { haptic } from "../utils/haptics";
import { useViewport } from "../hooks/useViewport";
import { formatDate } from "../utils/format";

const TEMPLATE_ICONS = { edit: IconEdit, clipboard: IconClipboard, document: IconDocument, check: IconCheck, user: IconUser };

// Loosely-typed rows + i18n t flow through the Cardigan data layer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration bridge for loosely-typed rows
type Row = any;
type TFn = (key: string, vars?: Record<string, unknown>) => string;

function relativeTime(dateStr: string | null | undefined, t: TFn) {
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

/* Per-action cap on attachment uploads. Drag-and-drop can hand us
   100+ files in one event; serialising 100 uploads burns the user's
   bandwidth and Vercel function quota for what is almost always a
   mis-drop. Cap + soft-warn. */
const MAX_UPLOADS_PER_ACTION = 10;
function capUploadBatch(files: File[], showToast: ((msg: string, kind?: string) => void) | undefined, t: TFn) {
  if (files.length > MAX_UPLOADS_PER_ACTION) {
    showToast?.(t("notes.attachments.tooMany", { count: MAX_UPLOADS_PER_ACTION }), "warning");
    return files.slice(0, MAX_UPLOADS_PER_ACTION);
  }
  return files;
}

/* ── Empty-note detection ──
   A note is "effectively empty" when:
   - Both title and body are whitespace-only, OR
   - Content matches a pristine template.
   On close we silently delete those instead of persisting clutter. */
function isEffectivelyEmpty(title: string, content: string, templates: Row[]) {
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
export function NoteEditor({ note, onSave, onDelete, onClose, layout = "overlay", originRect = null }: {
  note?: Row;
  onSave: (data: { title: string; content: string }) => Promise<unknown> | unknown;
  onDelete?: () => Promise<unknown> | unknown;
  onClose: () => void;
  layout?: string;
  originRect?: { left: number; top: number; width: number; height: number } | null;
}) {
  const inlineMode = layout === "inline";
  const { t } = useT();
  const { patients, upcomingSessions, togglePinNote, updateNoteLink, readOnly, showToast, uploadNoteAttachment, noteAttachments, noteCrypto, userName, setNoteCover } = useCardiganMain();
  const noteTemplates = useNoteTemplates();
  const { isDesktop } = useViewport();
  // Attachment src hook — called once at the parent so the strip
  // (thumbnails) and the MarkdownEditor (inline images) share one
  // resolver cache. Without this lift each surface would fetch +
  // decrypt every attachment independently.
  const attachmentSrc = useAttachmentSrc(note?.id || null);
  const [pinned, setPinned] = useState(!!note?.pinned);
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [linkedPatientId, setLinkedPatientId] = useState(note?.patient_id || "");
  const [linkedSessionId, setLinkedSessionId] = useState(note?.session_id || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const [exiting, setExiting] = useState(false);
  const [toast, setToast] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Reading mode strips the editor chrome (toolbar, header buttons,
  // syntax dimming) and widens the body to a centered max-width
  // column with bigger type. Useful for sharing a screen with a
  // colleague or reviewing a long note without edit cues.
  const [readingMode, setReadingMode] = useState(false);
  // Cover picker visibility (Phase E.2). Opens from the kebab.
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);

  // Debounced autosave lifecycle (800 ms timer, saved/saving/dirty
  // indicator, unmount-flush of pending typed content, and cancel-pending
  // for explicit-save paths) extracted to useNoteAutosave (WS-6).
  const { saveState, setSaveState, scheduleSave, cancelPending } = useNoteAutosave({
    onSave, readOnly, showToast, saveFailedMsg: t("notes.saveFailed"),
  });

  // Always close through this ref so "empty on close" → delete fires
  // regardless of what triggered the close (back button, ESC, etc.).
  // Synced via effect (not during render) to satisfy the React rules.
  const closeRef = useRef({ title, content, onSave, onDelete, onClose, note, readOnly, templates: noteTemplates });
  useEffect(() => {
    closeRef.current = { title, content, onSave, onDelete, onClose, note, readOnly, templates: noteTemplates };
  });

  const doClose = useCallback(async () => {
    const { title: ti, content: co, onSave: s, onDelete: d, onClose: cl, note: n, readOnly: ro, templates: tpls } = closeRef.current;
    // doClose persists explicitly below, so cancel any pending debounced
    // save first — otherwise the unmount-flush would double-write.
    cancelPending();
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
  }, [showToast, t, cancelPending]);

  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Autosave (debounce + dirty indicator + unmount flush) lives in
  // useNoteAutosave above; the change handlers below call scheduleSave.
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    scheduleSave(e.target.value, content);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editorRef.current?.focus();
    }
  };

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    scheduleSave(title, newContent);
  }, [scheduleSave, title]);

  const handleSelectionChange = useCallback(({ active }: { active?: Set<string> }) => {
    setActiveFormats(active || new Set());
  }, []);

  // Heading scroll-spy (IntersectionObserver tracking the topmost visible
  // heading). Extracted to useNoteOutline (WS-6); the outline drawer reads
  // activeHeadingLine to highlight the "you are here" entry.
  const activeHeadingLine = useNoteOutline(content, scrollRef);

  /* ── Scroll-shadow header ──────────────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 2);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  /* ── Link change ───────────────────────────────────────────────── */
  const handleLinkChange = async ({ patientId, sessionId }: { patientId: string | null; sessionId: string | null }) => {
    setLinkedPatientId(patientId || "");
    setLinkedSessionId(sessionId || "");
    if (note?.id) await updateNoteLink(note.id, { patientId, sessionId });
  };

  /* ── Format buttons ────────────────────────────────────────────── */
  const onInlineFormat = (kind: string) => editorRef.current?.applyInlineFormat(kind);
  const onBlockFormat = (block: string) => editorRef.current?.applyBlockFormat(block);

  /* ── Voice dictation ─────────────────────────────────────────────
     Hidden entirely on browsers without SpeechRecognition (Safari).
     Final transcript chunks land in the editor at the caret via the
     imperative API; interim text is shown live in the recording
     strip below the toolbar but is NOT inserted until the engine
     finalises it. We append a single trailing space after each
     finalised chunk so consecutive utterances stay readable. */
  const insertVoiceText = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    editorRef.current?.insertText(`${t} `);
  }, []);
  const dictation = useVoiceDictation({ lang: "es-MX", onResult: insertVoiceText });
  const toggleVoice = useCallback(() => {
    if (dictation.recording) {
      dictation.stop();
      haptic.tap();
    } else {
      // Focus the body before starting — voice transcripts always
      // route through the editor's insertText, and starting with
      // the title input focused would land the first words at the
      // body's caret (line 0, col 0) rather than where the user
      // is looking. Focus first → no surprise.
      editorRef.current?.focus();
      dictation.start();
      haptic.tap();
    }
  }, [dictation]);
  // If the user navigates / closes the editor mid-dictation, make
  // sure the recogniser is stopped so the mic indicator clears.
  // dictation.stop is useCallback-stable inside the hook, so this
  // effect's cleanup fires only on unmount.
  const stopVoice = dictation.stop;
  useEffect(() => () => { stopVoice(); }, [stopVoice]);
  // Surface a one-time toast on permission denial / mic missing so
  // the user knows why nothing happened. Suppress "no-speech" /
  // "aborted" — those are handled internally by the hook.
  const lastErrorRef = useRef("");
  useEffect(() => {
    // Reset the de-dupe ref when the error clears so the SAME error
    // code re-emerging later still fires a toast. Without this, a
    // user who hits "not-allowed", grants permission, then later has
    // the permission revoked would see the second failure silently
    // (no toast → no explanation for why the mic stopped).
    if (!dictation.error) {
      lastErrorRef.current = "";
      return;
    }
    if (dictation.error === lastErrorRef.current) return;
    lastErrorRef.current = dictation.error;
    const key =
      dictation.error === "not-allowed" ? "notes.voice.errPermission" :
      dictation.error === "audio-capture" ? "notes.voice.errMic" :
      dictation.error === "network" ? "notes.voice.errNetwork" :
      "notes.voice.errGeneric";
    showToast?.(t(key), "error");
  }, [dictation.error, showToast, t]);

  /* ── Image attachments ───────────────────────────────────────────
     Phase 5. Three ingress paths land here:
       - Toolbar paperclip → file-picker
       - Drag-and-drop onto the scroll area
       - Paste image into the editor body
     Each one ultimately calls uploadNoteAttachment, which inserts
     a row in note_attachments + uploads bytes to R2. We append a
     trailing newline + markdown reference at the end of the body
     so the source preserves the link even though v1 renders the
     image in the strip below the editor, not inline. */
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);

  const insertAttachmentMarkdown = useCallback((id: string) => {
    const ref = `\n![](attachment:${id})\n`;
    editorRef.current?.insertText(ref);
  }, []);

  const uploadFileAsAttachment = useCallback(async (file?: File | null) => {
    if (!file || !note?.id || readOnly) return;
    // 10MB ceiling — anything larger is almost always an iPhone HEIC
    // straight out of the camera, and our v1 doesn't HEIC-convert
    // (deferred to Phase 6 if telemetry shows pain).
    if (file.size > 10 * 1024 * 1024) {
      showToast?.(t("notes.attachments.tooLarge"), "error");
      return;
    }
    if (!/^image\//.test(file.type)) {
      showToast?.(t("notes.attachments.notImage"), "error");
      return;
    }
    setAttachBusy(true);
    try {
      const row = await uploadNoteAttachment({ noteId: note.id, file });
      if (row?.id) {
        insertAttachmentMarkdown(row.id);
        haptic.success();
      } else {
        showToast?.(t("notes.attachments.uploadFailed"), "error");
      }
    } finally {
      setAttachBusy(false);
    }
  }, [note?.id, readOnly, uploadNoteAttachment, insertAttachmentMarkdown, showToast, t]);

  const onPaperclipClick = useCallback(() => {
    if (attachBusy || readOnly || !note?.id) return;
    attachInputRef.current?.click();
  }, [attachBusy, readOnly, note?.id]);

  const onAttachInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-uploading the same file later
    const files = capUploadBatch(all, showToast, t);
    for (const f of files) {
      // Serial — concurrent uploads compete for the same network
      // and confuse the progress bar UX. Most users attach one at
      // a time anyway.
      await uploadFileAsAttachment(f);
    }
  }, [uploadFileAsAttachment, showToast, t]);

  const onScrollPaste = useCallback((e: React.ClipboardEvent) => {
    if (readOnly || !note?.id) return;
    const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
    for (const it of items) {
      if (it.kind === "file" && /^image\//.test(it.type)) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          uploadFileAsAttachment(file);
          return;
        }
      }
    }
  }, [readOnly, note?.id, uploadFileAsAttachment]);

  const onScrollDrop = useCallback(async (e: React.DragEvent) => {
    if (readOnly || !note?.id) return;
    e.preventDefault();
    setDragOver(false);
    const all = Array.from(e.dataTransfer?.files || []).filter(f => /^image\//.test(f.type));
    const files = capUploadBatch(all, showToast, t);
    for (const f of files) {
      await uploadFileAsAttachment(f);
    }
  }, [readOnly, note?.id, uploadFileAsAttachment, showToast, t]);

  const onScrollDragOver = useCallback((e: React.DragEvent) => {
    if (readOnly || !note?.id) return;
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  }, [readOnly, note?.id]);

  const onScrollDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the editor entirely — bubbling
    // dragleave inside child elements would otherwise flicker.
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);

  /* ── Restore-from-history ────────────────────────────────────────
     Three concerns we have to thread carefully:

     1. The 60s snapshot debounce in `snapshot_note` would otherwise
        UPDATE the most-recent version row in place when restore
        fires, overwriting the user's pre-restore current state and
        deleting it from the timeline. We force a `debounceSeconds=0`
        snapshot of the CURRENT (pre-restore) content first; that
        guarantees a discrete row, and updateNote's auto-snapshot
        afterwards is allowed to UPDATE _that_ row to the restored
        content — the pre-restore content survives one version
        further back.

     2. Restoring an encrypted note while the vault is locked would
        re-save it as plaintext (maybeEncrypt returns
        { encrypted:false } when locked) and flip the encrypted
        flag off — privacy regression. Refuse.

     3. If the save itself fails, we must roll React state back to
        the pre-restore content — otherwise the editor shows the
        "restored" content while the DB still holds the old content,
        and the next keystroke would silently persist the divergence. */
  const handleRestoreVersion = useCallback(async ({ title: newTitle, content: newContent }: { title?: string; content?: string }) => {
    // The kebab menu (and therefore Historial) is already gated on
    // !readOnly, so this branch is unreachable from the UI. Belt-and-
    // braces in case a future caller wires restore from somewhere
    // else — readOnly mode (admin view-as) must never write.
    if (readOnly) throw new Error("read_only");
    if (note?.encrypted && noteCrypto && !noteCrypto.canEncrypt) {
      throw new Error("locked");
    }

    // (#1) Preserve pre-restore content in the timeline.
    try {
      const preTitle = title || "";
      const preContent = content || "";
      const wrapped = noteCrypto?.encrypt
        ? await noteCrypto.encrypt(preContent)
        : { content: preContent, encrypted: false };
      await enqueue("notes.snapshot", {
        noteId: note.id,
        titleCt: preTitle,
        contentCt: wrapped.content,
        encrypted: !!wrapped.encrypted,
        debounceSeconds: 0,
      });
    } catch {
      /* best-effort — proceed with restore even if the preservation
         snapshot couldn't be enqueued. The user's intent (restore)
         wins over the safety net. */
    }

    // (#4) Capture pre-restore state so we can roll back on save failure.
    const prevTitle = title;
    const prevContent = content;
    setTitle(newTitle || "");
    setContent(newContent || "");
    editorRef.current?.setContent(newContent || "");
    cancelPending();
    setSaveState("saving");
    try {
      await onSave({ title: newTitle || "", content: newContent || "" });
      setSaveState("saved");
    } catch {
      setTitle(prevTitle);
      setContent(prevContent);
      editorRef.current?.setContent(prevContent || "");
      setSaveState("dirty");
      throw new Error("save_failed");
    }
  }, [note, noteCrypto, title, content, onSave, readOnly, cancelPending, setSaveState]);

  /* ── Find + outline ────────────────────────────────────────────── */
  const handleJumpToMatch = useCallback((match: { line: number; startCol: number; endCol: number }) => {
    editorRef.current?.jumpTo(match);
  }, []);
  const handleJumpToLine = useCallback((line: number) => {
    editorRef.current?.jumpTo({ line, startCol: 0, endCol: 0 });
    if (!isDesktop) setOutlineOpen(false);
  }, [isDesktop]);
  const hasHeadings = useMemo(() => extractOutline(content).length > 0, [content]);

  /* ── Template pick — only for brand-new empty notes ────────────── */
  const pickTemplate = (tpl: Row) => {
    setTitle(tpl.title);
    setContent(tpl.content);
    editorRef.current?.setContent(tpl.content);
    scheduleSave(tpl.title, tpl.content);
    editorRef.current?.focus();
    haptic.tap();
  };

  /* ── Export/copy menu ──────────────────────────────────────────── */
  const flashToast = (msg: string) => {
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

  /* ── Resolve an attachment row into a base64 data URL for the PDF
     renderer. Pure side-effect — no React state; the PDF helper
     awaits the promise per attachment. Encrypted rows go through
     the bytes lane (fetch → decrypt → b64); unencrypted rows just
     reuse the presigned URL → blob → b64 pipeline. */
  const resolveAttachmentDataUrl = useCallback(async (att: Row) => {
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const headers = {
        "Authorization": `Bearer ${s?.access_token}`,
        "Content-Type": "application/json",
      };
      const res = await fetch("/api/note-attachment-url", {
        method: "POST", headers,
        body: JSON.stringify({
          path: att.r2_path,
          mime: att.encrypted ? "application/octet-stream" : att.mime,
        }),
      });
      if (!res.ok) return null;
      const { url } = await res.json();
      if (!url) return null;
      const r = await fetch(url);
      if (!r.ok) return null;
      let bytes = new Uint8Array(await r.arrayBuffer());

      if (att.encrypted) {
        if (!noteCrypto?.decryptAttachmentBytes) return null;
        const plain = await noteCrypto.decryptAttachmentBytes(bytes, att.iv);
        if (!plain) return null;
        bytes = plain;
      }
      // Build a data URL with the row's original mime so jsPDF can
      // sniff JPEG / PNG / WEBP correctly. The final base64 here is
      // unavoidable — jsPDF.addImage wants either a data URL or an
      // <img> reference, and constructing an <img> + waiting for it
      // is heavier than the single bytes→base64 pass.
      let bin = "";
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const b64 = btoa(bin);
      return `data:${att.mime || "image/jpeg"};base64,${b64}`;
    } catch {
      return null;
    }
  }, [noteCrypto]);

  const exportPdf = async () => {
    if (!note?.id) { setMenuOpen(false); return; }
    setMenuOpen(false);
    const noteAttachmentsForThis = (noteAttachments || []).filter((a: Row) => a.note_id === note.id);
    const linkedPatient = note.patient_id ? (patients || []).find((p: Row) => p.id === note.patient_id) : null;
    const linkedSession = note.session_id ? (upcomingSessions || []).find((s: Row) => s.id === note.session_id) : null;
    try {
      // Lazy-load notePdf (and its jsPDF dep) so the ~700KB lib
      // never lands in the main bundle. Vite splits this into its
      // own chunk on first call.
      const { downloadNotePdf } = await import("../lib/notePdf");
      await downloadNotePdf({
        note: { ...note, title, content },
        attachments: noteAttachmentsForThis,
        patient: linkedPatient,
        session: linkedSession,
        therapistName: userName || "",
        imageResolver: resolveAttachmentDataUrl,
      });
      haptic.success();
      flashToast(t("notes.pdfExported"));
    } catch {
      haptic.warn();
      showToast?.(t("notes.exportFailed"), "error");
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: Event) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".mde-menu") && !el.closest("[data-menu-trigger]")) setMenuOpen(false);
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
  // Templates render while the note is brand-new + empty. The moment
  // the user types anything we apply `is-collapsed` so the chooser
  // animates out; once the keyframe completes we drop it from the DOM
  // entirely. Without the delayed unmount the snap-disappear felt
  // abrupt and stole the eye away from where the caret just landed.
  const [templatesMounted, setTemplatesMounted] = useState(isBrandNewEmpty);
  useEffect(() => {
    if (isBrandNewEmpty) { setTemplatesMounted(true); return; }
    if (!templatesMounted) return;
    const t = setTimeout(() => setTemplatesMounted(false), 360);
    return () => clearTimeout(t);
  }, [isBrandNewEmpty, templatesMounted]);

  const shellClass =
    (inlineMode ? "note-editor-inline" : "note-editor-desktop") +
    (!inlineMode ? (exiting ? " note-editor-exit" : " note-editor-enter") : "") +
    (readingMode ? " mde-reading-mode" : "");

  // Single predicate for "is this a valid row-anchored origin?" so
  // the inline CSS vars + the data-from-origin attribute stay in
  // lockstep. Either both fire (rect is valid) or neither does (rect
  // missing or zero-dim).
  const hasValidOrigin = !!(
    originRect
    && typeof window !== "undefined"
    && originRect.width > 4
    && originRect.height > 4
  );
  const shellStyle: React.CSSProperties = inlineMode
    ? { flex: 1, minHeight: 0, background: "var(--white)", display: "flex", flexDirection: "column" }
    : {
        position: "fixed", inset: 0, background: "var(--white)", zIndex: "var(--z-note-editor)", display: "flex", flexDirection: "column",
        ...(hasValidOrigin && originRect ? {
          "--mde-origin-x":  `${originRect.left}px`,
          "--mde-origin-y":  `${originRect.top}px`,
          "--mde-origin-sx": originRect.width  / window.innerWidth,
          "--mde-origin-sy": originRect.height / window.innerHeight,
        } : {}),
      } as React.CSSProperties;

  return (
    <div className={shellClass} style={shellStyle} data-from-origin={hasValidOrigin ? "true" : undefined}>
      {/* ── Header ────────────────────────────────────────────── */}
      <div className={"mde-header" + (scrolled ? " is-scrolled" : "")}>
        <button className="mde-back" onClick={handleClose}>‹ {t("back")}</button>
        <div className="mde-header-actions">
          {!readOnly && (
            <span className={"mde-save-indicator " + (saveState === "saved" ? "is-saved" : "is-saving")}>
              <span className="mde-save-dot" aria-hidden="true" />
              <span className="mde-save-label">
                {saveState === "saved" ? t("notes.saved") : t("notes.saving")}
              </span>
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
                </svg>
              </button>
              {menuOpen && (
                <div className="mde-menu" role="menu">
                  <button className="mde-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setFindOpen(true); }}>
                    <IconSearchMenu />
                    <span>{t("notes.find.placeholder")}</span>
                  </button>
                  <button className="mde-menu-item" role="menuitem" onClick={() => {
                    setMenuOpen(false);
                    // Entering reading mode hides the voice strip and
                    // its stop button. If dictation is live, that
                    // would orphan the mic with no way to stop it.
                    if (!readingMode && dictation.recording) dictation.stop();
                    setReadingMode(v => !v);
                  }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2 6a3 3 0 0 1 3-3h5v17H5a3 3 0 0 1-3-3V6z" />
                      <path d="M22 6a3 3 0 0 0-3-3h-5v17h5a3 3 0 0 0 3-3V6z" />
                    </svg>
                    <span>{readingMode ? t("notes.readingExit") : t("notes.readingMode")}</span>
                  </button>
                  {note?.id && (
                    <button className="mde-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setCoverPickerOpen(true); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2.4" />
                        <circle cx="9" cy="9" r="1.6" />
                        <path d="M21 17l-5-5L7 21" />
                      </svg>
                      <span>{note.cover_attachment_id ? t("notes.cover.change") : t("notes.cover.set")}</span>
                    </button>
                  )}
                  {note?.id && (
                    <button className="mde-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setHistoryOpen(true); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 12a9 9 0 1 0 3-6.7" />
                        <polyline points="3 4 3 9 8 9" />
                        <polyline points="12 7 12 12 16 14" />
                      </svg>
                      <span>{t("notes.history")}</span>
                    </button>
                  )}
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
                  {note?.id && (
                    <button className="mde-menu-item" role="menuitem" onClick={exportPdf}>
                      <IconDownload size={15} />
                      <span>{t("notes.exportPdf")}</span>
                    </button>
                  )}
                  <div className="mde-menu-sep" />
                  {/* "Report typing issue" — captures a Sentry event
                      stamped with the last ~50 editor input breadcrumbs
                      so we can see the actual event sequence behind a
                      typing bug instead of guessing. No PII: breadcrumbs
                      log inputType + data length + composition state,
                      never the typed characters themselves. */}
                  <button
                    className="mde-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      captureMessage("editor.user-reported-typing-bug", {
                        level: "warning",
                        tags: { editor: "notes" },
                      });
                      showToast?.(t("notes.reportTypingThanks") || "Gracias — reporte enviado.", "success");
                    }}
                  >
                    <IconEdit size={15} />
                    <span>{t("notes.reportTyping") || "Reportar problema al escribir"}</span>
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
          voiceSupported={dictation.supported}
          voiceRecording={dictation.recording}
          onVoiceToggle={toggleVoice}
          onAttachClick={note?.id ? onPaperclipClick : undefined}
        />
      )}

      {/* ── Voice recording strip ─────────────────────────────────
         Shown only while the recogniser is live. Pulses the mic
         indicator and surfaces the interim transcript so the user
         can see what's being heard before it commits. */}
      {!readOnly && dictation.recording && (
        <div className="mde-voice-strip" role="status" aria-live="polite">
          <span className="mde-voice-dot" aria-hidden="true" />
          <span className="mde-voice-label">
            {dictation.interim
              ? dictation.interim
              : t("notes.voice.listening")}
          </span>
          <button
            type="button"
            className="mde-voice-stop btn-tap"
            onClick={toggleVoice}
            aria-label={t("notes.voice.stop")}
          >
            {t("notes.voice.stop")}
          </button>
        </div>
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
            style={{ maxWidth: 340, borderRadius: "var(--radius-lg)", margin: "0 20px", animation: "sheetScaleIn 0.45s var(--ease-spring)" }}>
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
              <button className="btn btn-danger" onClick={async () => { haptic.warn(); await onDelete?.(); onClose(); }}>
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
      <div
        ref={scrollRef}
        className={"mde-scroll" + (dragOver ? " is-drag-over" : "")}
        onPaste={onScrollPaste}
        onDrop={onScrollDrop}
        onDragOver={onScrollDragOver}
        onDragLeave={onScrollDragLeave}
      >
        {dateStr && <div className="mde-date">{dateStr}</div>}

        {/* Templates chooser. Stays MOUNTED across the brand-new →
            typed transition so we can collapse it with a CSS
            animation instead of snapping it out. The delayed-unmount
            (templatesMounted state above) keeps the node alive long
            enough for the keyframe to finish. */}
        {!readOnly && templatesMounted && (
          <div className={"mde-templates" + (isBrandNewEmpty ? "" : " is-collapsed")} aria-hidden={!isBrandNewEmpty}>
            <div className="mde-templates-label">{t("notes.templates")}</div>
            <div className="mde-template-pills">
              {noteTemplates.filter((tp: Row) => tp.id !== "blank").map((tpl: Row) => {
                const Ic = TEMPLATE_ICONS[tpl.icon as keyof typeof TEMPLATE_ICONS];
                return (
                  <button key={tpl.id} type="button" className="mde-template-pill" onClick={() => pickTemplate(tpl)} tabIndex={isBrandNewEmpty ? 0 : -1}>
                    {Ic && <Ic size={14} />}
                    <span>{tpl.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Cover hero — Phase E.2. Renders only when the note has a
            cover_attachment_id. Reserve the slot while the
            attachment URL resolves so the title doesn't jump down
            when the image lands. Tap-target opens the picker so the
            user can switch / remove the cover. Cursor flips to
            default when disabled (readOnly). */}
        {note?.cover_attachment_id && (() => {
          const coverTile = attachmentSrc.tiles[note.cover_attachment_id];
          const coverUrl = coverTile?.url;
          const coverFailed = !coverUrl && coverTile?.failed;
          // Failed cover: tap retries the resolve. Loading: shimmer
          // placeholder reserves the 16:9 slot so the title doesn't
          // jump down when the image lands. Resolved: hero image,
          // tap opens the picker.
          const handleClick = () => {
            if (readOnly) return;
            if (coverFailed) { attachmentSrc.retryTile(note.cover_attachment_id); return; }
            setCoverPickerOpen(true);
          };
          return (
            <button
              type="button"
              className={"mde-cover btn-tap" + (coverUrl ? "" : " is-loading") + (coverFailed ? " is-failed" : "")}
              onClick={handleClick}
              disabled={readOnly}
              style={readOnly ? { cursor: "default" } : undefined}
              aria-label={coverFailed ? t("notes.attachments.retry") : t("notes.cover.change")}
              aria-busy={!coverUrl && !coverFailed}
            >
              {coverUrl
                ? <img src={coverUrl} alt="" />
                : coverFailed
                  ? <span className="mde-cover-retry" aria-hidden="true">↻</span>
                  : <span className="mde-cover-shimmer" aria-hidden="true" />}
            </button>
          );
        })()}

        {/* Title is wrapped so we can hang a focus underline off the
            parent — <input> can't carry ::after pseudo-elements. */}
        <span className="mde-title-wrap">
          <input
            type="text"
            className="mde-title"
            value={title}
            onChange={handleTitleChange}
            onKeyDown={handleTitleKeyDown}
            placeholder={t("notes.titlePlaceholder")}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- a brand-new note focuses its title so the user can type immediately
            autoFocus={!readOnly && !note?.id}
            readOnly={readOnly}
            aria-label={t("notes.titlePlaceholder")}
          />
        </span>

        <MarkdownEditor
          ref={editorRef}
          initialContent={content}
          /* Reading mode rides on top of the editor's existing
             readOnly path: contenteditable goes off so the caret
             can't land, but the body remains selectable for copy.
             Toggling out restores edit mode without remounting. */
          readOnly={readOnly || readingMode}
          onContentChange={handleContentChange}
          onSelectionChange={handleSelectionChange}
          onRequestFind={() => setFindOpen(true)}
          placeholder={t("notes.bodyPlaceholder")}
          attachmentTiles={attachmentSrc.tiles}
        />

        {note?.id && (
          <AttachmentStrip
            tiles={attachmentSrc.tiles}
            retryTile={attachmentSrc.retryTile}
            rows={attachmentSrc.rows}
          />
        )}

        {/* Hidden file input — paperclip click opens this. We accept
            image/* and let uploadFileAsAttachment enforce the precise
            allowlist + size cap. */}
        {!readOnly && note?.id && (
          <input
            ref={attachInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            onChange={onAttachInputChange}
            style={{ display: "none" }}
            aria-hidden="true"
            tabIndex={-1}
          />
        )}

        {dragOver && (
          <div className="mde-drop-overlay" aria-hidden="true">
            <div className="mde-drop-overlay-inner">{t("notes.attachments.dropHere")}</div>
          </div>
        )}
      </div>

      {/* Footer (word count + reading time). Hidden until there's
          actual content — "0 palabras" on a brand-new note is noise
          that competes with the empty-state placeholder. Numbers
          render with tabular-nums so they don't dance between
          keystrokes. */}
      {wordCount > 0 && (
        <div className="mde-footer">
          <span className="mde-footer-left">
            {readingMins > 0 ? t("notes.readingTime", { mins: readingMins }) : ""}
          </span>
          <span className="mde-footer-right">
            {t("notes.wordCountLabel", { count: wordCount, plural: wordCount === 1 ? "" : "s" })}
          </span>
        </div>
      )}

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
              activeLine={activeHeadingLine}
            />
          </div>
        </div>
      )}

      {/* ── Version history sheet ────────────────────────────────── */}
      {note?.id && (
        <VersionHistorySheet
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          note={note}
          onRestore={handleRestoreVersion}
        />
      )}

      {/* ── Cover picker sheet (Phase E.2) ────────────────────────── */}
      {note?.id && (
        <CoverPickerSheet
          open={coverPickerOpen}
          onClose={() => setCoverPickerOpen(false)}
          attachmentRows={attachmentSrc.rows}
          tiles={attachmentSrc.tiles}
          currentCoverId={note.cover_attachment_id || null}
          onPick={(attachmentId) => setNoteCover?.(note.id, attachmentId)}
          onClear={() => setNoteCover?.(note.id, null)}
          onRequestAttach={onPaperclipClick}
        />
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

export function NoteCard({ note, onClick, patientName, sessionLabel, onPatientClick }: {
  note: Row;
  onClick?: () => void;
  patientName?: string;
  sessionLabel?: string;
  onPatientClick?: () => void;
}) {
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
