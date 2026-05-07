import { useEffect, useRef, useState } from "react";
import { IconDocument } from "./Icons";
import ContextMenu, { useContextMenu } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { useT } from "../i18n/index";
import { useCardigan } from "../context/CardiganContext";
import { useEscape } from "../hooks/useEscape";
import { haptic } from "../utils/haptics";
import { parseFolderLink, shortenForDisplay } from "../utils/folderLinks";

/* ── ExternalFolderCard ──────────────────────────────────────────────
   One card, three visible states (empty / linked / editing). Sits at
   the top of the patient's Documentos tab so the user can jump
   straight from the expediente into their cloud folder (Drive,
   OneDrive, Dropbox, iCloud, SharePoint, or any URL).

   Cardigan never accesses the linked content — the URL is just text
   stored on the patients row. Avoids OAuth / token storage / LFPDPPP
   "finalidad" expansion entirely.

   The component is the only place that touches the URL parser
   (utils/folderLinks). All security-relevant validation flows
   through parseFolderLink before anything renders into <a href>. */

// Provider visual identity. Kept here (not in folderLinks.js) because
// these are presentational concerns — the parser cares about
// detection, the UI cares about color + glyph. Tints are the brand
// colors at ~12% opacity so the icon circle reads as branded
// without yelling. Each glyph is the official monochrome mark from
// SimpleIcons (CC0).
const PROVIDER_VIS = {
  google_drive: {
    tint: "#1A73E81F", // 12% blue
    fg: "#1A73E8",
    Glyph: ({ size = 18 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.828 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214Zm2.259 12.225L7.63 18.713l-1.88 3.275 5.514.01c3.034.005 7.27.005 9.42 0l3.91-.011-1.83-3.262c-1.009-1.793-1.86-3.276-1.89-3.296-.026-.025-3.244-.04-7.148-.034l-7.104.008z"/>
      </svg>
    ),
  },
  onedrive: {
    tint: "#0078D41F",
    fg: "#0078D4",
    Glyph: ({ size = 18 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.2 7.999a4.99 4.99 0 0 0-4.792 3.578 3.997 3.997 0 0 0-3.408 3.946 3.998 3.998 0 0 0 3.998 3.998h11.999a3.5 3.5 0 0 0 3.5-3.5 3.5 3.5 0 0 0-2.93-3.45A5 5 0 0 0 17.2 8.5a5 5 0 0 0-1.65.282A4.989 4.989 0 0 0 12.2 8z"/>
      </svg>
    ),
  },
  dropbox: {
    tint: "#0061FF1F",
    fg: "#0061FF",
    Glyph: ({ size = 18 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 2 0 5.928l6 3.928 6-3.928zm12 0-6 3.928 6 3.928 6-3.928zM0 13.785l6 3.929 6-3.929-6-3.928zm18-3.928-6 3.928 6 3.929 6-3.929zM6 19.071l6 3.929 6-3.929-6-3.928z"/>
      </svg>
    ),
  },
  icloud: {
    tint: "#9999991F",
    fg: "#666666",
    Glyph: ({ size = 18 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13.762 4.29a6.51 6.51 0 0 0-5.669 3.332 3.571 3.571 0 0 0-1.558-.36 3.571 3.571 0 0 0-3.516 3A4.918 4.918 0 0 0 0 14.796a4.918 4.918 0 0 0 4.92 4.914 4.93 4.93 0 0 0 .617-.045h14.42c2.305-.272 4.041-2.258 4.043-4.589v-.009a4.594 4.594 0 0 0-3.727-4.508 6.51 6.51 0 0 0-6.511-6.27z"/>
      </svg>
    ),
  },
  generic: {
    tint: "var(--teal-pale)",
    fg: "var(--teal-dark)",
    Glyph: ({ size = 18 }) => <IconDocument size={size} />,
  },
};

function ProviderIcon({ provider, size = 40 }) {
  const vis = PROVIDER_VIS[provider] || PROVIDER_VIS.generic;
  const { Glyph, tint, fg } = vis;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: tint,
        color: fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <Glyph size={Math.round(size * 0.45)} />
    </div>
  );
}

// External-link arrow glyph — sits on the right of a linked card to
// reinforce "this leaves the app." Kept inline so the visual doesn't
// rely on ChevronRight which already means "navigate within app."
function ExternalArrow({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function KebabIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function ExternalFolderCard({ url, onSave, readOnly = false }) {
  const { t } = useT();
  const { showToast } = useCardigan();
  const ctxMenu = useContextMenu();

  // editing = true → render the input form. When false, the card
  // renders as either empty (no url) or linked (has url) — derived
  // from the prop, not local state, so an external revert (e.g.,
  // optimistic save fails) flows back into the UI without manual
  // sync.
  const [editing, setEditing] = useState(false);
  // Local input state. Initialized lazily when entering edit mode.
  const [draft, setDraft] = useState("");
  // Track the value the user STARTED with so we can detect "dirty"
  // for the discard-changes confirm.
  const initialDraftRef = useRef("");
  // Saving state: a quick toggle while the parent's onSave promise
  // resolves. Powers the disabled state on the Save button.
  const [saving, setSaving] = useState(false);
  // Discard-changes confirm dialog visibility. Shown only when the
  // user tries to cancel with unsaved edits.
  const [discardOpen, setDiscardOpen] = useState(false);
  // Remove confirm dialog visibility.
  const [removeOpen, setRemoveOpen] = useState(false);

  const inputRef = useRef(null);
  const editFormRef = useRef(null);

  const parsed = parseFolderLink(url || "");
  const linked = parsed.valid;

  const draftParsed = parseFolderLink(draft);
  const draftDirty = draft.trim() !== initialDraftRef.current.trim();

  const enterEditMode = () => {
    if (readOnly) return;
    initialDraftRef.current = url || "";
    setDraft(url || "");
    setEditing(true);
  };

  // Auto-focus the input + select-all so paste-to-replace is one
  // gesture for the user editing an existing link.
  useEffect(() => {
    if (!editing) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [editing]);

  // Click-outside to cancel — but if the draft is dirty, surface the
  // discard-changes confirm first instead of silently dropping the
  // user's typing.
  useEffect(() => {
    if (!editing) return;
    const handler = (e) => {
      if (editFormRef.current?.contains(e.target)) return;
      // Don't trigger cancel-on-outside when a dialog is up — the
      // dialog overlays sit outside the form ref but are part of
      // the same logical interaction.
      if (discardOpen || removeOpen) return;
      attemptCancel();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, discardOpen, removeOpen, draftDirty]);

  useEscape(editing ? () => attemptCancel() : null);

  function attemptCancel() {
    if (draftDirty) {
      setDiscardOpen(true);
      return;
    }
    setEditing(false);
  }

  function confirmDiscard() {
    setDiscardOpen(false);
    setEditing(false);
    setDraft("");
  }

  async function handleSave() {
    if (saving) return;
    if (!draftParsed.valid) return;
    setSaving(true);
    try {
      const result = await onSave?.(draftParsed.url);
      if (result === false) {
        // Parent signaled failure; the parent already surfaced its
        // own toast via the existing setMutationError path. Stay in
        // edit mode so the user can retry without re-typing.
        return;
      }
      haptic.tap();
      setEditing(false);
    } catch {
      showToast(t("expediente.folder.saveError"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (saving) return;
    setRemoveOpen(false);
    setSaving(true);
    try {
      await onSave?.(null);
      setEditing(false);
    } catch {
      showToast(t("expediente.folder.saveError"), "error");
    } finally {
      setSaving(false);
    }
  }

  const openKebab = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const items = [
      {
        key: "edit",
        label: t("expediente.folder.edit"),
        onSelect: enterEditMode,
      },
      {
        key: "remove",
        label: t("expediente.folder.remove"),
        destructive: true,
        onSelect: () => setRemoveOpen(true),
      },
    ];
    ctxMenu.openAt(e, items);
  };

  // ── Editing state (replaces empty/linked in place) ──
  if (editing) {
    const errorKey =
      draft.trim() === ""
        ? null
        : draftParsed.valid
        ? null
        : draftParsed.reason === "bad_scheme"
        ? "expediente.folder.errorBadScheme"
        : draftParsed.reason === "too_long"
        ? "expediente.folder.errorTooLong"
        : "expediente.folder.errorBadUrl";

    return (
      <>
        <div
          ref={editFormRef}
          className="card"
          style={{
            padding: "14px 14px 12px",
            marginBottom: 14,
            border: "1px solid var(--teal-mist)",
            background: "var(--white)",
          }}
          role="group"
          aria-label={t("expediente.folder.inputLabel")}
        >
          <label
            htmlFor="external-folder-url-input"
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--charcoal-xl)",
              marginBottom: 8,
            }}
          >
            {t("expediente.folder.inputLabel")}
          </label>
          <input
            id="external-folder-url-input"
            ref={inputRef}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draftParsed.valid && !saving) {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder={t("expediente.folder.inputPlaceholder")}
            className="input"
            aria-invalid={!!errorKey}
            aria-describedby={errorKey ? "external-folder-url-error" : undefined}
            style={{ width: "100%", fontSize: "var(--text-md)" }}
          />
          {errorKey && (
            <div
              id="external-folder-url-error"
              role="alert"
              style={{
                fontSize: 12,
                color: "var(--red)",
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              {t(errorKey)}
            </div>
          )}
          {/* Live preview of the about-to-save card so the user sees
              the provider before tapping Save. Only when valid + not
              identical to current. */}
          {draftParsed.valid && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 0 4px",
                marginTop: 6,
                borderTop: "1px solid var(--border-lt)",
                animation: "fadeIn 0.2s ease",
              }}
            >
              <ProviderIcon provider={draftParsed.provider} size={32} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontFamily: "var(--font-d)",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--charcoal)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {draftParsed.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--charcoal-md)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {shortenForDisplay(draftParsed.url)}
                </div>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!draftParsed.valid || saving}
              style={{
                flex: 1,
                height: 38,
                fontSize: "var(--text-sm)",
                opacity: !draftParsed.valid || saving ? 0.6 : 1,
              }}
            >
              {saving ? t("expediente.folder.saving") : t("expediente.folder.save")}
            </button>
            <button
              type="button"
              onClick={attemptCancel}
              disabled={saving}
              style={{
                height: 38,
                padding: "0 14px",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--charcoal-md)",
                fontFamily: "var(--font)",
              }}
            >
              {t("expediente.folder.cancel")}
            </button>
          </div>
        </div>
        <ConfirmDialog
          open={discardOpen}
          title={t("expediente.folder.discardChangesTitle")}
          body={t("expediente.folder.discardChangesBody")}
          confirmLabel={t("expediente.folder.discardChangesCta")}
          cancelLabel={t("cancel")}
          destructive
          onConfirm={confirmDiscard}
          onCancel={() => setDiscardOpen(false)}
        />
      </>
    );
  }

  // ── Empty state ──
  if (!linked) {
    if (readOnly) return null; // nothing to show; nothing to do
    return (
      <div
        className="card"
        style={{
          padding: "16px 14px",
          marginBottom: 14,
          border: "1px dashed var(--border)",
          background: "var(--cream)",
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "var(--white)",
            border: "1px solid var(--border-lt)",
            color: "var(--charcoal-xl)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <IconDocument size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 14,
              color: "var(--charcoal)",
              marginBottom: 2,
            }}
          >
            {t("expediente.folder.emptyTitle")}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--charcoal-md)",
              lineHeight: 1.4,
              marginBottom: 10,
            }}
          >
            {t("expediente.folder.emptyBody")}
          </div>
          <button
            type="button"
            className="chip-pill"
            onClick={enterEditMode}
            style={{
              height: 32,
              padding: "0 12px",
              fontSize: 12,
              fontWeight: 700,
              background: "var(--teal-pale)",
              color: "var(--teal-dark)",
              border: "1px solid var(--teal-mist)",
              borderRadius: "var(--radius-pill)",
              cursor: "pointer",
              fontFamily: "var(--font)",
            }}
          >
            + {t("expediente.folder.emptyCta")}
          </button>
          <div
            style={{
              fontSize: 11,
              color: "var(--charcoal-xl)",
              marginTop: 10,
              lineHeight: 1.4,
            }}
          >
            {t("expediente.folder.privacy")}
          </div>
        </div>
      </div>
    );
  }

  // ── Linked state ──
  // Two siblings inside the card: the <a> link wrapper covers the
  // primary tap area; the kebab is a separate, layered <button> so
  // (a) the HTML stays valid (anchors can't contain interactive
  // descendants) and (b) the kebab tap doesn't follow the href.
  return (
    <>
      <div
        className="card"
        style={{
          marginBottom: 14,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <a
          href={parsed.url}
          target="_blank"
          rel="noopener noreferrer"
          title={parsed.url}
          aria-label={`${t("expediente.folder.open")}: ${parsed.label}`}
          onClick={() => haptic.tap()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 56px 12px 14px", // right padding leaves room for the kebab + arrow
            textDecoration: "none",
            color: "inherit",
            WebkitTapHighlightColor: "transparent",
          }}
          className="external-folder-link"
        >
          <ProviderIcon provider={parsed.provider} size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: "var(--font-d)",
                fontSize: 14,
                fontWeight: 800,
                color: "var(--charcoal)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                letterSpacing: "-0.2px",
                marginBottom: 1,
              }}
            >
              {parsed.label}
            </div>
            <bdi
              style={{
                display: "block",
                fontSize: 12,
                color: "var(--charcoal-md)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenForDisplay(parsed.url)}
            </bdi>
          </div>
          {/* External-link arrow on the right edge — signals "this
              leaves Cardigan" without needing a separate badge.
              Standard pattern across iOS/web for external links. */}
          <span style={{ color: "var(--charcoal-xl)", flexShrink: 0 }} aria-hidden="true">
            <ExternalArrow size={14} />
          </span>
        </a>
        {!readOnly && (
          <button
            type="button"
            onClick={openKebab}
            aria-label={t("expediente.folder.menuLabel")}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 44,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--charcoal-xl)",
              WebkitTapHighlightColor: "transparent",
              padding: 0,
            }}
          >
            <KebabIcon size={16} />
          </button>
        )}
      </div>
      <ContextMenu {...ctxMenu.state} onClose={ctxMenu.close} />
      <ConfirmDialog
        open={removeOpen}
        title={t("expediente.folder.removeConfirmTitle")}
        body={t("expediente.folder.removeConfirmBody")}
        confirmLabel={t("expediente.folder.removeConfirmCta")}
        cancelLabel={t("cancel")}
        destructive
        busy={saving}
        onConfirm={handleRemove}
        onCancel={() => setRemoveOpen(false)}
      />
    </>
  );
}
