import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index.jsx";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { IconX } from "../Icons";
import { ConfirmDialog } from "../ConfirmDialog";
import { diffLines, diffSummary } from "../../lib/noteDiff";
import { formatDate } from "../../utils/format";
import { haptic } from "../../utils/haptics";

/* ── VersionHistorySheet ──────────────────────────────────────────
   Phase 2 of the Notes premium roadmap. Renders a chronological
   list of `note_versions` rows for the current note, plus a
   line-level diff against the previous version when a row is
   expanded.

   Diff direction: each row shows `prev → this` (the changes that
   landed IN this version, relative to the one before it). That
   matches how a git log reads — the version 5 entry shows what
   was added/removed between version 4 and version 5.

   Encryption: snapshots carry the same envelope as the live note,
   so we decrypt with the same `noteCrypto.decrypt(...)` the live
   path uses. A row whose decrypt fails (locked vault or corrupted
   payload) renders with a placeholder; we don't surface it as a
   visible error because the user already knows their vault state.

   Restore: calls the parent's `onRestore` with the decrypted
   { title, content }. The parent runs `updateNote(...)` which has
   the snapshot-on-success hook wired up — so the pre-restore
   content is captured as a fresh version too. Net result: every
   restore is itself reversible from the history. */

export function VersionHistorySheet({ open, onClose, note, onRestore }) {
  const { t } = useT();
  const { noteCrypto, showToast, setHideFab } = useCardigan();
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  // Pending-confirm version. Restore is a destructive-ish action
  // (overwrites the live note) so we route it through ConfirmDialog
  // — a mis-tap on the row's "Restaurar" button shouldn't silently
  // replace the user's current state.
  const [pendingRestore, setPendingRestore] = useState(null);
  // Whether the current vault state allows a safe restore. An
  // encrypted note + locked vault would flip the row to plaintext;
  // we surface a disabled state with explainer copy instead.
  const restoreBlockedByLock = !!note?.encrypted && noteCrypto && !noteCrypto.canEncrypt;

  // Fetch + decrypt on open. Cancellation flag prevents a stale
  // fetch (e.g. note swap while the sheet is animating in) from
  // overwriting the next fetch's results.
  useEffect(() => {
    if (!open || !note?.id) return;
    let alive = true;
    setVersions([]);
    setExpandedId(null);
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("note_versions")
        .select("id, version_no, created_at, title_ciphertext, content_ciphertext, encrypted")
        .eq("note_id", note.id)
        .order("version_no", { ascending: false });
      if (!alive) return;
      if (error) {
        showToast?.(t("notes.historyLoadFailed"), "error");
        setLoading(false);
        return;
      }
      const decrypted = await Promise.all((data || []).map(async (v) => {
        if (!v.encrypted) {
          return { ...v, title: v.title_ciphertext || "", content: v.content_ciphertext || "" };
        }
        if (!noteCrypto?.decrypt) {
          return { ...v, title: "", content: "", _decryptFailed: true };
        }
        const [titlePlain, contentPlain] = await Promise.all([
          noteCrypto.decrypt(v.title_ciphertext, true).catch(() => null),
          noteCrypto.decrypt(v.content_ciphertext, true).catch(() => null),
        ]);
        if (titlePlain == null || contentPlain == null) {
          return { ...v, title: "", content: "", _decryptFailed: true };
        }
        return { ...v, title: titlePlain, content: contentPlain };
      }));
      if (!alive) return;
      setVersions(decrypted);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, note?.id, noteCrypto, showToast, t]);

  useEffect(() => {
    if (!open) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [open, setHideFab]);

  useEscape(open ? onClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: open });
  const setPanel = useCallback((el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  }, [panelRef, scrollRef, setPanelEl]);

  const restore = useCallback(async (version) => {
    if (restoringId) return;
    setRestoringId(version.id);
    try {
      await onRestore?.({ title: version.title, content: version.content });
      haptic.success();
      showToast?.(t("notes.historyRestored"), "success");
      onClose?.();
    } catch (err) {
      haptic.warn();
      const key = err?.message === "locked"
        ? "notes.historyLockedToRestore"
        : "notes.saveFailed";
      showToast?.(t(key), "error");
    } finally {
      setRestoringId(null);
      setPendingRestore(null);
    }
  }, [restoringId, onRestore, onClose, showToast, t]);

  const requestRestore = useCallback((version) => {
    if (restoreBlockedByLock) {
      showToast?.(t("notes.historyLockedToRestore"), "error");
      return;
    }
    setPendingRestore(version);
  }, [restoreBlockedByLock, showToast, t]);

  if (!open) return null;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("notes.historyTitle")}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
        style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("notes.historyTitle")}</span>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label={t("close")}
          >
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "0 20px 24px", overflowY: "auto", flex: 1 }} className="scroll-bounce">
          {loading ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: "var(--charcoal-md)", fontSize: "var(--text-sm)" }}>
              {t("loading")}
            </div>
          ) : versions.length === 0 ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: "var(--charcoal-md)", fontSize: "var(--text-sm)" }}>
              {t("notes.historyEmpty")}
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {versions.map((v, idx) => {
                const prev = versions[idx + 1]; // older neighbour
                const hasPrev = !!prev && !prev._decryptFailed;
                const summary = !v._decryptFailed && hasPrev
                  ? diffSummary(prev.content || "", v.content || "")
                  : null;
                const expanded = expandedId === v.id;
                const isLatest = idx === 0;
                return (
                  <li key={v.id} style={{ borderBottom: "1px solid var(--border-lt)" }}>
                    <button
                      type="button"
                      className="btn-tap"
                      onClick={() => { haptic.tap(); setExpandedId(expanded ? null : v.id); }}
                      aria-expanded={expanded}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "14px 0",
                        background: "transparent",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: "var(--font)",
                      }}
                    >
                      <span style={{
                        fontFamily: "var(--font-d)",
                        fontWeight: 800,
                        fontSize: "var(--text-md)",
                        color: "var(--charcoal)",
                        minWidth: 76,
                      }}>
                        {t("notes.historyVersion", { n: v.version_no })}
                      </span>
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", flex: 1 }}>
                        {formatDate(v.created_at, "longTime")}
                      </span>
                      {isLatest && (
                        <span style={{
                          fontSize: "var(--text-xs)", fontWeight: 700,
                          padding: "2px 8px", borderRadius: "var(--radius-pill)",
                          background: "var(--teal-pale)", color: "var(--teal-dark)",
                          letterSpacing: "0.04em", textTransform: "uppercase",
                        }}>
                          {t("notes.historyCurrent")}
                        </span>
                      )}
                      {summary && (summary.added > 0 || summary.removed > 0) && (
                        <span style={{
                          fontSize: "var(--text-xs)", fontWeight: 700,
                          fontVariantNumeric: "tabular-nums",
                          display: "inline-flex", gap: 6,
                        }}>
                          {summary.added > 0 && <span style={{ color: "var(--green)" }}>+{summary.added}</span>}
                          {summary.removed > 0 && <span style={{ color: "var(--red)" }}>−{summary.removed}</span>}
                        </span>
                      )}
                    </button>

                    {expanded && (
                      <div style={{ paddingBottom: 14 }}>
                        {v._decryptFailed ? (
                          <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", padding: "8px 0" }}>
                            {t("notes.historyDecryptFailed")}
                          </div>
                        ) : (
                          <>
                            {v.title && (
                              <div style={{
                                fontFamily: "var(--font-d)", fontWeight: 700,
                                fontSize: "var(--text-md)", color: "var(--charcoal)",
                                marginBottom: 10,
                              }}>
                                {v.title}
                              </div>
                            )}
                            <VersionDiff before={prev?.content || ""} after={v.content || ""} hasPrev={hasPrev} />
                            {!isLatest && (
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => requestRestore(v)}
                                disabled={restoringId === v.id || restoreBlockedByLock}
                                style={{ marginTop: 14, width: "100%" }}
                              >
                                {restoringId === v.id ? t("loading") : t("notes.historyRestore")}
                              </button>
                            )}
                            {restoreBlockedByLock && !isLatest && (
                              <div style={{ fontSize: "var(--text-xs)", color: "var(--charcoal-md)", marginTop: 8 }}>
                                {t("notes.historyLockedToRestore")}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!pendingRestore}
        title={t("notes.historyRestoreConfirmTitle")}
        body={t("notes.historyRestoreConfirmBody")}
        confirmLabel={t("notes.historyRestore")}
        cancelLabel={t("cancel")}
        busy={!!restoringId}
        onConfirm={() => pendingRestore && restore(pendingRestore)}
        onCancel={() => setPendingRestore(null)}
      />
    </div>
  );
}

/* Inline diff renderer. Same-type chunks paint as a single strip
   so a 20-line unchanged block reads as one rectangle, not 20
   thin slivers. Teal-mist for added, red-bg for removed (with
   strikethrough), transparent for unchanged. */
function VersionDiff({ before, after, hasPrev }) {
  const { t } = useT();
  const chunks = useMemo(() => {
    if (!hasPrev) {
      return after ? [{ type: "same", text: after }] : [];
    }
    return diffLines(before, after);
  }, [before, after, hasPrev]);

  if (chunks.length === 0) {
    return (
      <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)" }}>
        {t("notes.historyNoChanges")}
      </div>
    );
  }

  return (
    <div style={{
      fontSize: "var(--text-sm)",
      lineHeight: 1.55,
      maxHeight: "40vh",
      overflowY: "auto",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      fontFamily: "var(--font)",
      border: "1px solid var(--border-lt)",
      borderRadius: "var(--radius)",
      padding: "8px 10px",
      background: "var(--white)",
    }} className="scroll-bounce">
      {chunks.map((c, i) => (
        <div
          key={i}
          style={{
            padding: "2px 6px",
            margin: "2px 0",
            borderRadius: 4,
            background:
              c.type === "added" ? "var(--teal-mist)"
              : c.type === "removed" ? "var(--red-bg)"
              : "transparent",
            color: c.type === "removed" ? "var(--charcoal-md)" : "var(--charcoal)",
            textDecoration: c.type === "removed" ? "line-through" : "none",
          }}
        >
          {c.text || " "}
        </div>
      ))}
    </div>
  );
}
