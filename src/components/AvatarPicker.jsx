import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { IconX, IconCamera, IconUpload } from "./Icons";
import { useT } from "../i18n/index";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useEscape } from "../hooks/useEscape";
import { SegmentedControl } from "./SegmentedControl";
import { PRESET_AVATARS, PRESET_AVATAR_IDS, renderPresetAvatar } from "./avatars/registry";
import { resizeToSquareJpeg, avatarPath } from "../utils/imageUpload";
import { supabase } from "../supabaseClient";
import { haptic } from "../utils/haptics";
import { invalidateAvatarUrl } from "../hooks/useAvatarUrl";

/* ── Cardigan avatar picker ─────────────────────────────────────────
   Bottom sheet with two tabs:
     - "Galería"  → grid of 12 hand-drawn presets
     - "Subir"    → upload / replace with a user photo

   Opens from the Settings profile card. Saves via
   supabase.auth.updateUser({ data: { avatar } }); that mutation fires
   onAuthStateChange on the app, which refreshes `user` everywhere the
   avatar is rendered (drawer, chrome, settings). */

const KIND_PRESET = "preset";
const KIND_UPLOADED = "uploaded";

export function AvatarPicker({ user, currentAvatar, onClose, onSaved }) {
  const { t } = useT();
  useEscape(onClose);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el) => { scrollRef.current = el; setPanelEl(el); };

  // Working state: whatever the user has "touched" but not yet saved.
  // Kind is either "preset", "uploaded-file" (local, not yet uploaded),
  // or "remove" (user wants to revert to initials).
  const [draft, setDraft] = useState(() => fromCurrent(currentAvatar));
  const [tab, setTab] = useState(draft.kind === "uploaded-file" || draft.kind === KIND_UPLOADED ? "upload" : "gallery");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [dropHover, setDropHover] = useState(false);
  const previewUrlRef = useRef(null);
  // Revoke any in-flight object-URL we created when the sheet closes
  // or the next file replaces it.
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  const initial = (userName.charAt(0) || "?").toUpperCase();

  const isDirty = useMemo(() => {
    return !sameAvatar(draftToStored(draft), currentAvatar);
  }, [draft, currentAvatar]);

  const onPickPreset = (id) => {
    setError("");
    setDraft({ kind: KIND_PRESET, presetId: id });
    haptic.tap();
  };

  const onFile = useCallback(async (file) => {
    setError("");
    if (!file) return;
    try {
      const blob = await resizeToSquareJpeg(file, 256);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const previewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = previewUrl;
      setDraft({ kind: "uploaded-file", blob, previewUrl });
      setTab("upload");
      haptic.tap();
    } catch (err) {
      const msg = err?.message || "";
      if (msg === "too_large") setError(t("avatar.err.tooLarge") || "La imagen debe pesar menos de 10 MB.");
      else if (msg === "not_image") setError(t("avatar.err.notImage") || "Selecciona una imagen.");
      else setError(t("avatar.err.generic") || "No se pudo procesar la imagen.");
    }
  }, [t]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDropHover(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  const onRemove = () => {
    setError("");
    setDraft({ kind: "remove" });
    haptic.warn();
  };

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      let nextAvatar = null;

      if (draft.kind === "remove") {
        nextAvatar = null;
      } else if (draft.kind === KIND_PRESET) {
        nextAvatar = { kind: KIND_PRESET, value: `preset:${draft.presetId}` };
      } else if (draft.kind === "uploaded-file") {
        const path = avatarPath(user.id);
        await uploadBlobToR2(path, draft.blob);
        // If we're replacing a prior uploaded avatar, drop its cached URL.
        if (currentAvatar?.kind === KIND_UPLOADED) invalidateAvatarUrl(currentAvatar.value);
        nextAvatar = { kind: KIND_UPLOADED, value: path };
      } else {
        // No effective change; just close.
        onClose();
        return;
      }

      const { error: updErr } = await supabase.auth.updateUser({
        data: { avatar: nextAvatar },
      });
      if (updErr) throw Object.assign(new Error(updErr.message || "update_failed"), { stage: "update" });

      haptic.success();
      onSaved?.(nextAvatar);
      onClose();
    } catch (err) {
      // Surface a stage-specific user message AND log the raw error so
      // anything that sneaks through (network timeout, CORS preflight
      // reject, Supabase rate limit, etc.) is diagnosable from the
      // browser console.
      console.error("[avatar] save failed", { stage: err?.stage, message: err?.message, err });
      const stage = err?.stage;
      if (stage === "presign")   setError(t("avatar.err.presign") || "No se pudo iniciar la subida. Revisa tu conexión.");
      else if (stage === "put")  setError(t("avatar.err.upload")  || "No se pudo subir la imagen. Intenta de nuevo.");
      else if (stage === "update") setError(t("avatar.err.update") || "La foto se subió pero no se guardó tu perfil. Intenta de nuevo.");
      else setError(t("avatar.err.save") || "No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  // ── Preview (top of sheet) ────────────────────────────────────────
  const previewNode = useMemo(() => {
    if (draft.kind === KIND_PRESET) {
      return renderPresetAvatar(draft.presetId, 96);
    }
    if (draft.kind === "uploaded-file") {
      return <img src={draft.previewUrl} alt="" />;
    }
    if (draft.kind === KIND_UPLOADED) {
      return <img src={draft.imageUrl} alt="" />;
    }
    // "remove" or nothing selected → initials
    return initial;
  }, [draft, initial]);

  const previewLabel = useMemo(() => {
    if (draft.kind === KIND_PRESET) return PRESET_AVATARS[draft.presetId]?.label || "";
    if (draft.kind === "uploaded-file") return t("avatar.uploadedPending") || "Foto lista para guardar";
    if (draft.kind === KIND_UPLOADED) return t("avatar.uploaded") || "Foto actual";
    if (draft.kind === "remove") return t("avatar.noPhoto") || "Sin foto";
    return userName;
  }, [draft, userName, t]);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("avatar.title") || "Cambiar foto"}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("avatar.title") || "Cambiar foto"}</span>
          <button className="sheet-close" aria-label={t("close") || "Cerrar"} onClick={onClose}>
            <IconX size={14} />
          </button>
        </div>

        <div className="av-picker-body">
          <div className="av-picker-preview-row">
            <div className="av-picker-preview">{previewNode}</div>
            <div className="av-picker-preview-meta">
              <div className="av-picker-preview-label">{previewLabel}</div>
              <div className="av-picker-preview-sub">{user?.email}</div>
              {currentAvatar && (
                <button className="av-picker-remove" onClick={onRemove} disabled={draft.kind === "remove"}>
                  {t("avatar.remove") || "Quitar foto"}
                </button>
              )}
            </div>
          </div>

          <div className="av-picker-tabs">
            <SegmentedControl
              items={[
                { k: "gallery", l: t("avatar.tabGallery") || "Galería" },
                { k: "upload",  l: t("avatar.tabUpload")  || "Subir" },
              ]}
              value={tab}
              onChange={setTab}
              ariaLabel={t("avatar.title") || "Cambiar foto"}
            />
          </div>

          {tab === "gallery" && (
            <div className="av-picker-grid" role="radiogroup" aria-label={t("avatar.tabGallery") || "Galería"}>
              {PRESET_AVATAR_IDS.map((id) => {
                const isSel = draft.kind === KIND_PRESET && draft.presetId === id;
                const preset = PRESET_AVATARS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={"av-picker-tile" + (isSel ? " is-selected" : "")}
                    onClick={() => onPickPreset(id)}
                    aria-label={preset.label}
                    aria-pressed={isSel ? "true" : "false"}
                    role="radio"
                    aria-checked={isSel ? "true" : "false"}
                  >
                    {renderPresetAvatar(id, 96)}
                  </button>
                );
              })}
            </div>
          )}

          {tab === "upload" && (
            <div
              className={"av-picker-drop" + (dropHover ? " is-hover" : "")}
              onDragOver={(e) => { e.preventDefault(); setDropHover(true); }}
              onDragLeave={() => setDropHover(false)}
              onDrop={onDrop}
            >
              <div className="av-picker-drop-icon">
                <IconUpload size={22} />
              </div>
              <div className="av-picker-drop-title">
                {t("avatar.dropTitle") || "Sube tu propia foto"}
              </div>
              <div className="av-picker-drop-sub">
                {t("avatar.dropSub") || "JPG o PNG hasta 10 MB. Se recorta automáticamente en círculo."}
              </div>
              <div className="av-picker-drop-buttons">
                <button
                  type="button"
                  className="av-picker-drop-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <IconUpload size={14} />
                  {t("avatar.chooseFile") || "Elegir archivo"}
                </button>
                <button
                  type="button"
                  className="av-picker-drop-btn"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <IconCamera size={14} />
                  {t("avatar.takePhoto") || "Cámara"}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="user"
                style={{ display: "none" }}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
          )}

          {error && <div className="av-picker-error" role="alert">{error}</div>}

          <div className="av-picker-actions">
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
              {t("cancel") || "Cancelar"}
            </button>
            <button
              className="btn btn-primary-teal"
              onClick={save}
              disabled={!isDirty || saving}
            >
              {saving ? (t("saving") || "Guardando…") : (t("save") || "Guardar")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────── */

function fromCurrent(a) {
  if (!a) return { kind: "none" };
  if (a.kind === KIND_PRESET && typeof a.value === "string") {
    const id = a.value.startsWith("preset:") ? a.value.slice("preset:".length) : a.value;
    return { kind: KIND_PRESET, presetId: id };
  }
  if (a.kind === KIND_UPLOADED && typeof a.value === "string") {
    return { kind: KIND_UPLOADED, path: a.value };
  }
  return { kind: "none" };
}

function draftToStored(d) {
  if (!d || d.kind === "none") return null;
  if (d.kind === "remove") return null;
  if (d.kind === KIND_PRESET) return { kind: KIND_PRESET, value: `preset:${d.presetId}` };
  if (d.kind === "uploaded-file") return { kind: "uploaded-file" }; // sentinel — never equal to currentAvatar
  if (d.kind === KIND_UPLOADED) return { kind: KIND_UPLOADED, value: d.path };
  return null;
}

function sameAvatar(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.value === b.value;
}

/* Upload the resized avatar blob to R2 via the existing presigned-URL
   flow. Throws with a `stage` property so the caller can show
   stage-specific user copy and log enough context to diagnose. */
async function uploadBlobToR2(path, blob) {
  // ── Stage 1: get a presigned PUT URL from our own API.
  let token;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token;
  } catch (e) {
    throw Object.assign(new Error("session_failed"), { stage: "presign", cause: e });
  }
  if (!token) throw Object.assign(new Error("no_session"), { stage: "presign" });

  let presignRes;
  try {
    presignRes = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path, contentType: "image/jpeg" }),
    });
  } catch (e) {
    throw Object.assign(new Error(e?.message || "presign_fetch_failed"), { stage: "presign", cause: e });
  }
  if (!presignRes.ok) {
    const body = await presignRes.text().catch(() => "");
    throw Object.assign(new Error(`presign_${presignRes.status}`), { stage: "presign", body });
  }
  let url;
  try {
    ({ url } = await presignRes.json());
  } catch (e) {
    throw Object.assign(new Error("presign_parse_failed"), { stage: "presign", cause: e });
  }
  if (!url) throw Object.assign(new Error("presign_no_url"), { stage: "presign" });

  // ── Stage 2: PUT the blob directly to R2 using the signed URL.
  let putRes;
  try {
    putRes = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
  } catch (e) {
    // A CORS preflight rejection or network error lands here. The
    // message is usually "Failed to fetch" (Chrome) or "Load failed"
    // (Safari) — neither is super actionable without the URL origin.
    throw Object.assign(new Error(e?.message || "put_fetch_failed"), { stage: "put", cause: e });
  }
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => "");
    throw Object.assign(new Error(`put_${putRes.status}`), { stage: "put", body });
  }
  return true;
}
