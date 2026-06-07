import { useEffect, useMemo, useRef, useState } from "react";
import { getClientColor } from "../../data/seedData";
import { Avatar } from "../Avatar";
import { ConfirmDialog } from "../ConfirmDialog";
import { IconX, IconSearch } from "../Icons";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { haptic } from "../../utils/haptics";
import { parseFolderLink, shortenForDisplay } from "../../utils/folderLinks";

/* ── ShareFolderSheet ─────────────────────────────────────────────
   Receiver UI for the PWA's Web Share Target. When the user opens
   Drive/OneDrive (or any app with a folder share sheet), taps
   Share, and picks Cardigan, the OS launches us with the folder
   URL in the query string. App.jsx detects `?share_folder=1` and
   mounts this sheet.

   The sheet's job: take the URL, ask the user "vincular a qué
   paciente?", and write it onto that patient. Zero copy/paste —
   the entire flow is share → pick → done.

   We deliberately render the URL preview at the top so the user
   sees what's about to be linked before committing — the share
   sheet on iOS doesn't always pass the friendly title, and we
   don't want to silently link a wrong URL. */

const PROVIDER_TINTS = {
  google_drive: "#1A73E8",
  onedrive:     "#0078D4",
  dropbox:      "#0061FF",
  icloud:       "#666666",
  generic:      "var(--teal-dark)",
};

export function ShareFolderSheet({ open, url, onClose, onLinked }) {
  const { t } = useT();
  const { patients, updatePatient, showToast, setHideFab, openExpediente } = useCardigan();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: open });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const { exiting, animatedClose } = useSheetExit(open, onClose);
  useEscape(open ? animatedClose : null);

  useEffect(() => {
    if (!open) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [open, setHideFab]);

  // Reset state on every open transition. A second share event
  // after a previous flow shouldn't keep the prior search query
  // or stuck-saving flag. Adjust-during-render pattern (matches
  // Drawer.jsx + RatingSheet.jsx) — the only setState call here
  // is inside an open-flipped check, so it doesn't loop.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSearch("");
      setSaving(false);
    }
  }

  const parsed = useMemo(() => parseFolderLink(url || ""), [url]);

  // Active + potential patients are the only sensible link targets.
  // Discarded / ended don't get folders attached. Sorted alphabetically
  // for predictable picker ordering.
  const eligible = useMemo(() => {
    return (patients || [])
      .filter((p) => p.status === "active" || p.status === "potential")
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));
  }, [patients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter((p) => (p.name || "").toLowerCase().includes(q));
  }, [eligible, search]);

  // Held while we wait for the user to confirm overwriting an
  // existing folder link. Capturing the patient (not just the id)
  // so the confirm dialog can show the name without re-finding it.
  const [pendingOverwrite, setPendingOverwrite] = useState(null);
  // Tracked so a setState after an unmount no-ops cleanly.
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // Internal commit — the actual write. Used by both the
  // tap-without-existing-link path and the post-confirm path.
  const commitPick = async (patient) => {
    if (!parsed.valid || saving) return;
    setSaving(true);
    haptic.tap();
    const ok = await updatePatient?.(patient.id, { external_folder_url: parsed.url });
    if (isMountedRef.current) setSaving(false);
    if (ok) {
      showToast(t("expediente.folder.shareLinkedToast", { name: patient.name }), "success");
      onLinked?.(patient);
      animatedClose();
      // Land the user on the patient's expediente — they came in via
      // a system share, the natural next step is "see what just got
      // linked." openExpediente sets up the navigation so closing
      // the expediente drops them on Patients.
      openExpediente?.(patient);
    } else {
      showToast(t("expediente.folder.saveError"), "error");
    }
  };

  const handlePick = (patient) => {
    if (!parsed.valid || saving) return;
    // If the picked patient already has a folder linked, surface a
    // ConfirmDialog before clobbering it. The audit flagged this as
    // P1 because a user who shares to the wrong patient by accident
    // would silently lose their original link.
    if (patient.external_folder_url) {
      setPendingOverwrite(patient);
      return;
    }
    commitPick(patient);
  };

  if (!open) return null;

  // Bad URL path — show a clear "we couldn't read what you shared"
  // state instead of an empty picker. The user can dismiss and
  // retry from the source app.
  if (!parsed.valid) {
    return (
      <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={animatedClose}>
        <div
          ref={setPanel}
          className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={t("expediente.folder.shareSheetTitle")}
          onClick={(e) => e.stopPropagation()}
          {...panelHandlers}
        >
          <div className="sheet-handle" />
          <div className="sheet-header">
            <span className="sheet-title">{t("expediente.folder.shareSheetTitle")}</span>
            <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}>
              <IconX size={14} />
            </button>
          </div>
          <div style={{ padding: "0 20px 28px" }}>
            <div
              style={{
                padding: "16px",
                background: "var(--cream)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border-lt)",
                fontSize: "var(--text-sm)",
                color: "var(--charcoal-md)",
                lineHeight: 1.5,
              }}
            >
              {t("expediente.folder.shareInvalidBody")}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={animatedClose}
              style={{ width: "100%", marginTop: 14 }}
            >
              {t("close")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={animatedClose}>
      <div
        ref={setPanel}
        className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("expediente.folder.shareSheetTitle")}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
        style={{ maxHeight: "min(92lvh, calc(100lvh - var(--sat) - 16px))" }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("expediente.folder.shareSheetTitle")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}>
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "0 20px 22px" }}>
          {/* URL preview — confirms what's about to be saved before
              the user commits. iOS share sheets sometimes pass a
              naked URL; macOS sometimes passes title + URL. We show
              the parsed provider + a shortened path so the user
              sees the right thing without scrolling a long token. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              background: "var(--cream)",
              border: "1px solid var(--border-lt)",
              borderRadius: "var(--radius)",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: `${PROVIDER_TINTS[parsed.provider] || PROVIDER_TINTS.generic}1F`,
                color: PROVIDER_TINTS[parsed.provider] || PROVIDER_TINTS.generic,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 16,
                fontWeight: 800,
              }}
              aria-hidden="true"
            >
              {parsed.label.charAt(0).toUpperCase()}
            </div>
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
                {parsed.label}
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
                {shortenForDisplay(parsed.url)}
              </div>
            </div>
          </div>

          {eligible.length === 0 ? (
            <div
              style={{
                padding: "24px 16px",
                background: "var(--white)",
                border: "1px solid var(--border-lt)",
                borderRadius: "var(--radius)",
                textAlign: "center",
                color: "var(--charcoal-md)",
                fontSize: "var(--text-sm)",
                lineHeight: 1.5,
              }}
            >
              {t("expediente.folder.shareNoPatients")}
            </div>
          ) : (
            <>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "var(--charcoal-xl)",
                  marginBottom: 8,
                }}
              >
                {t("expediente.folder.sharePickPatient")}
              </div>
              {/* Search row — shown only when the list would benefit
                  from filtering. Below 6 patients the search is
                  noise; above, it's necessary. */}
              {eligible.length >= 6 && (
                <div
                  style={{
                    position: "relative",
                    marginBottom: 10,
                  }}
                >
                  <input
                    ref={inputRef}
                    type="search"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("patients.searchPlaceholder")}
                    className="input"
                    style={{ width: "100%", paddingLeft: 36 }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--charcoal-xl)",
                      pointerEvents: "none",
                    }}
                    aria-hidden="true"
                  >
                    <IconSearch size={14} />
                  </span>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  maxHeight: "55vh",
                  overflowY: "auto",
                }}
              >
                {filtered.length === 0 ? (
                  <div
                    style={{
                      padding: "16px",
                      textAlign: "center",
                      fontSize: "var(--text-sm)",
                      color: "var(--charcoal-md)",
                    }}
                  >
                    {t("patients.noResults")}
                  </div>
                ) : (
                  filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePick(p)}
                      disabled={saving}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        background: "var(--white)",
                        border: "1px solid var(--border-lt)",
                        borderRadius: "var(--radius)",
                        cursor: saving ? "default" : "pointer",
                        textAlign: "left",
                        fontFamily: "var(--font)",
                        WebkitTapHighlightColor: "transparent",
                        opacity: saving ? 0.6 : 1,
                      }}
                    >
                      <Avatar
                        initials={p.initials}
                        color={
                          p.status === "potential"
                            ? "var(--rose)"
                            : getClientColor(p.colorIdx)
                        }
                        size="md"
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "var(--font-d)",
                            fontWeight: 700,
                            fontSize: 14,
                            color: "var(--charcoal)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.name}
                        </div>
                        {p.status === "potential" && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--rose)",
                              fontWeight: 700,
                              marginTop: 2,
                            }}
                          >
                            {t("patients.statusPotential")}
                          </div>
                        )}
                        {p.external_folder_url && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--charcoal-xl)",
                              marginTop: 2,
                              lineHeight: 1.3,
                            }}
                          >
                            {t("expediente.folder.shareReplaceHint")}
                          </div>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!pendingOverwrite}
        title={t("expediente.folder.shareReplaceTitle", { name: pendingOverwrite?.name || "" })}
        body={t("expediente.folder.shareReplaceBody")}
        confirmLabel={t("expediente.folder.shareReplaceCta")}
        cancelLabel={t("cancel")}
        destructive
        busy={saving}
        onConfirm={() => {
          const target = pendingOverwrite;
          setPendingOverwrite(null);
          if (target) commitPick(target);
        }}
        onCancel={() => setPendingOverwrite(null)}
      />
    </div>
  );
}
