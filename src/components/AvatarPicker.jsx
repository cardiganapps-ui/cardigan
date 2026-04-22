import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { IconX, IconCamera, IconUpload } from "./Icons";
import { useT } from "../i18n/index";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useEscape } from "../hooks/useEscape";
import { resizeToSquareJpeg, avatarPath } from "../utils/imageUpload";
import { supabase } from "../supabaseClient";
import { haptic } from "../utils/haptics";
import { invalidateAvatarUrl } from "../hooks/useAvatarUrl";
import { AVATAR_PRESETS, presetUrl, isPresetId } from "../data/avatarPresets";

/* ── Cardigan avatar picker ─────────────────────────────────────────
   Bottom sheet with two ways to set a profile photo:

   1. Preset gallery — a curated set of line-art avatars
      (dog, cat, plant, …) stored as static SVGs in /avatars/.
      Saved in user_metadata.avatar as
        { kind: "preset", value: "<id>" }.
   2. Upload — user picks an image (camera / library / drop zone),
      it's resized client-side to a 256² JPEG, uploaded via
      /api/upload-url (server-proxied to R2), and saved as
        { kind: "uploaded", value: "<path>" }. */

const KIND_UPLOADED = "uploaded";
const KIND_PRESET   = "preset";

export function AvatarPicker({ user, currentAvatar, onClose, onSaved }) {
  const { t } = useT();
  useEscape(onClose);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el) => { scrollRef.current = el; setPanelEl(el); };

  // Working state. Kind is either "uploaded-file" (new local file,
  // not yet uploaded), "uploaded" (current saved image), "remove"
  // (user wants to revert to initials), or "none".
  const [draft, setDraft] = useState(() => fromCurrent(currentAvatar));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [dropHover, setDropHover] = useState(false);
  const previewUrlRef = useRef(null);
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  const initial = (userName.charAt(0) || "?").toUpperCase();

  const isDirty = useMemo(() => {
    return !sameAvatar(draftToStored(draft), currentAvatar);
  }, [draft, currentAvatar]);

  const onFile = useCallback(async (file) => {
    setError("");
    if (!file) return;
    try {
      const blob = await resizeToSquareJpeg(file, 256);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const previewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = previewUrl;
      setDraft({ kind: "uploaded-file", blob, previewUrl });
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

  const onPickPreset = (id) => {
    if (!isPresetId(id)) return;
    setError("");
    setDraft({ kind: KIND_PRESET, id });
    haptic.tap();
  };

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      let nextAvatar = null;

      if (draft.kind === "remove") {
        nextAvatar = null;
      } else if (draft.kind === "uploaded-file") {
        const path = avatarPath(user.id);
        await uploadBlobToR2(path, draft.blob);
        if (currentAvatar?.kind === KIND_UPLOADED) invalidateAvatarUrl(currentAvatar.value);
        nextAvatar = { kind: KIND_UPLOADED, value: path };
      } else if (draft.kind === KIND_PRESET) {
        if (currentAvatar?.kind === KIND_UPLOADED) invalidateAvatarUrl(currentAvatar.value);
        nextAvatar = { kind: KIND_PRESET, value: draft.id };
      } else {
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
      console.error("[avatar] save failed", { stage: err?.stage, message: err?.message, err });
      const stage = err?.stage;
      if (stage === "presign")    setError(t("avatar.err.presign") || "No se pudo iniciar la subida. Revisa tu conexión.");
      else if (stage === "put")   setError(t("avatar.err.upload")  || "No se pudo subir la imagen. Intenta de nuevo.");
      else if (stage === "update") setError(t("avatar.err.update") || "La foto se subió pero no se guardó tu perfil. Intenta de nuevo.");
      else setError(t("avatar.err.save") || "No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  // Preview at the top of the sheet
  const previewNode = useMemo(() => {
    if (draft.kind === "uploaded-file") return <img src={draft.previewUrl} alt="" />;
    if (draft.kind === KIND_UPLOADED) return <img src={draft.imageUrl} alt="" />;
    if (draft.kind === KIND_PRESET) return <img src={presetUrl(draft.id)} alt="" />;
    return initial;
  }, [draft, initial]);

  const previewLabel = useMemo(() => {
    if (draft.kind === "uploaded-file") return t("avatar.uploadedPending") || "Foto lista para guardar";
    if (draft.kind === KIND_UPLOADED) return t("avatar.uploaded") || "Foto actual";
    if (draft.kind === KIND_PRESET) return t("avatar.presetSelected") || "Avatar seleccionado";
    if (draft.kind === "remove") return t("avatar.noPhoto") || "Sin foto";
    return userName;
  }, [draft, userName, t]);

  const selectedPresetId = draft.kind === KIND_PRESET ? draft.id : null;

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

          <div className="av-picker-section-label">
            {t("avatar.presetTitle") || "Elige un avatar"}
          </div>
          {AVATAR_PRESETS.length > 0 ? (
            <div className="av-picker-grid" role="radiogroup" aria-label={t("avatar.presetTitle") || "Elige un avatar"}>
              {AVATAR_PRESETS.map((p) => {
                const selected = p.id === selectedPresetId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={t(p.labelKey) || p.id}
                    className={"av-picker-tile" + (selected ? " is-selected" : "")}
                    onClick={() => onPickPreset(p.id)}
                  >
                    <img src={presetUrl(p.id)} alt="" draggable={false} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="av-picker-coming-soon" role="note">
              <div className="av-picker-coming-soon-title">
                {t("avatar.presetComingSoon") || "Avatares próximamente"}
              </div>
              <div className="av-picker-coming-soon-sub">
                {t("avatar.presetComingSoonSub") || "Por ahora puedes subir tu propia foto."}
              </div>
            </div>
          )}

          <div className="av-picker-section-label av-picker-section-label-sep">
            {t("avatar.uploadTitle") || "O sube tu propia foto"}
          </div>
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
              <button type="button" className="av-picker-drop-btn" onClick={() => fileInputRef.current?.click()}>
                <IconUpload size={14} />
                {t("avatar.chooseFile") || "Elegir archivo"}
              </button>
              <button type="button" className="av-picker-drop-btn" onClick={() => cameraInputRef.current?.click()}>
                <IconCamera size={14} />
                {t("avatar.takePhoto") || "Cámara"}
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={(e) => onFile(e.target.files?.[0])} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="user" style={{ display: "none" }}
              onChange={(e) => onFile(e.target.files?.[0])} />
          </div>

          {error && <div className="av-picker-error" role="alert">{error}</div>}

          <div className="av-picker-actions">
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
              {t("cancel") || "Cancelar"}
            </button>
            <button className="btn btn-primary-teal" onClick={save} disabled={!isDirty || saving}>
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
  if (a.kind === KIND_UPLOADED && typeof a.value === "string") {
    return { kind: KIND_UPLOADED, path: a.value };
  }
  if (a.kind === KIND_PRESET && isPresetId(a.value)) {
    return { kind: KIND_PRESET, id: a.value };
  }
  return { kind: "none" };
}

function draftToStored(d) {
  if (!d || d.kind === "none") return null;
  if (d.kind === "remove") return null;
  if (d.kind === "uploaded-file") return { kind: "uploaded-file" }; // sentinel — never equal to currentAvatar
  if (d.kind === KIND_UPLOADED) return { kind: KIND_UPLOADED, value: d.path };
  if (d.kind === KIND_PRESET) return { kind: KIND_PRESET, value: d.id };
  return null;
}

function sameAvatar(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.value === b.value;
}

async function uploadBlobToR2(path, blob) {
  let token;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token;
  } catch (e) {
    throw Object.assign(new Error("session_failed"), { stage: "presign", cause: e });
  }
  if (!token) throw Object.assign(new Error("no_session"), { stage: "presign" });

  let dataUrl;
  try {
    dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("read_failed"));
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    throw Object.assign(new Error(e?.message || "encode_failed"), { stage: "put", cause: e });
  }

  let res;
  try {
    res = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path, dataUrl }),
    });
  } catch (e) {
    throw Object.assign(new Error(e?.message || "put_fetch_failed"), { stage: "put", cause: e });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`put_${res.status}`), { stage: "put", body });
  }
  return true;
}
