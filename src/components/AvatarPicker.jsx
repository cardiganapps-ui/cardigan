import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { IconX, IconUpload } from "./Icons";
import { useT } from "../i18n/index";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useEscape } from "../hooks/useEscape";
import { avatarPath } from "../utils/imageUpload";
import { supabase } from "../supabaseClient";
import { haptic } from "../utils/haptics";
import { invalidateAvatarUrl, setAvatarUrl } from "../hooks/useAvatarUrl";
import { useCardigan } from "../context/CardiganContext";
import { AVATAR_PRESETS, presetUrl, isPresetId } from "../data/avatarPresets";
import { AvatarCropEditor } from "./AvatarCropEditor";

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
  // Pulled from context so the upload-path can fire toasts AFTER the
  // sheet closes (the optimistic-close flow leaves no UI behind in
  // the AvatarPicker itself for inline error display).
  const { showSuccess, showToast } = useCardigan() || {};
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

  /* ── File pick → crop preview ──
     Confirm the pick is an image, then route into the crop editor.
     No byte-size cap: users can't see file sizes in their photo
     library before picking, so a pre-flight bound is just a
     confusing dead end. The cropper always emits a 256² JPEG, so
     the source size only affects local decode RAM — fine on any
     modern device for any reasonable photo. If decode does fail
     (corrupt file, exotic format), the cropper surfaces its own
     "no se pudo cargar" UI with a Volver button. */
  const onFile = useCallback((file) => {
    setError("");
    if (!file) return;
    if (!(file.type || "").startsWith("image/")) {
      setError(t("avatar.err.notImage") || "Selecciona una imagen.");
      return;
    }
    setDraft({ kind: "cropping", file });
    haptic.tap();
  }, [t]);

  /* When the cropper hands back a final blob, switch to "uploaded-file"
     state — the existing save path picks it up unchanged. */
  const onCropConfirm = useCallback((blob) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const previewUrl = URL.createObjectURL(blob);
    previewUrlRef.current = previewUrl;
    setDraft({ kind: "uploaded-file", blob, previewUrl });
    haptic.success();
  }, []);

  const onCropCancel = useCallback(() => {
    setDraft(fromCurrent(currentAvatar));
  }, [currentAvatar]);

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

    /* Uploaded photo path: optimistic close. The R2 upload + auth
       metadata update + session refresh chain takes ~600-1000ms on
       mobile. Blocking the sheet that long for what reads as "save"
       feels broken. We pre-cache a local blob URL keyed by the
       future R2 path so AvatarContent can render the new avatar
       the moment the auth state propagates, close the sheet
       immediately, and run the actual work in the background.
       Errors surface via the toast queue (an inline error in a
       dismissed sheet would be invisible). */
    if (draft.kind === "uploaded-file") {
      const path = avatarPath(user.id);
      const blob = draft.blob;
      const previousAvatar = currentAvatar;
      const localBlobUrl = URL.createObjectURL(blob);
      // Seed the cache with the local blob URL keyed by the FUTURE
      // R2 path. useAvatarUrl picks this up on the next render and
      // shows the new avatar instantly; the actual signed-URL fetch
      // is short-circuited until invalidateAvatarUrl fires (e.g.
      // hard reload re-fetches the real R2 URL — which is fine
      // because the upload has long since completed).
      setAvatarUrl(path, localBlobUrl);
      onClose();
      showSuccess?.(t("avatar.saving") || "Guardando avatar…");

      (async () => {
        try {
          await uploadBlobToR2(path, blob);
          if (previousAvatar?.kind === KIND_UPLOADED) invalidateAvatarUrl(previousAvatar.value);
          const nextAvatar = { kind: KIND_UPLOADED, value: path };
          const { data: updData, error: updErr } = await supabase.auth.updateUser({
            data: { avatar: nextAvatar },
          });
          if (updErr) throw Object.assign(new Error(updErr.message || "update_failed"), { stage: "update" });
          try { await supabase.auth.refreshSession(); } catch (_) { /* non-fatal */ }
          haptic.success();
          onSaved?.(nextAvatar, updData?.user || null);
        } catch (err) {
          // Roll back the optimistic blob URL — leaving it would
          // serve a stale local image after a hard reload, since
          // the auth metadata never landed. Free the URL too so
          // we don't leak the blob.
          invalidateAvatarUrl(path);
          try { URL.revokeObjectURL(localBlobUrl); } catch { /* ignore */ }
          const tag = err?.code || err?.status ? ` (${err?.code || `HTTP ${err?.status}`})` : "";
          showToast?.((t("avatar.err.save") || "No se pudo guardar avatar.") + tag, "error");
          console.error("[avatar] background save failed", {
            stage: err?.stage, status: err?.status, code: err?.code,
            hint: err?.hint, message: err?.message, info: err?.info, err,
          });
        }
      })();
      return;
    }

    /* Preset / remove paths stay synchronous — no R2 upload, just
       a single auth.updateUser round-trip (~300ms). The user is
       picking an avatar from a grid; they expect to see the
       confirmation land before the sheet closes. */
    setSaving(true);
    try {
      let nextAvatar = null;

      if (draft.kind === "remove") {
        nextAvatar = null;
      } else if (draft.kind === KIND_PRESET) {
        if (currentAvatar?.kind === KIND_UPLOADED) invalidateAvatarUrl(currentAvatar.value);
        nextAvatar = { kind: KIND_PRESET, value: draft.id };
      } else {
        onClose();
        return;
      }

      const { data: updData, error: updErr } = await supabase.auth.updateUser({
        data: { avatar: nextAvatar },
      });
      if (updErr) throw Object.assign(new Error(updErr.message || "update_failed"), { stage: "update" });

      // Force the session to reload so onAuthStateChange fires and
      // React state picks up the new user_metadata. supabase-js 2.x
      // doesn't consistently emit USER_UPDATED when only metadata
      // changes — refreshSession reliably delivers TOKEN_REFRESHED
      // with the updated user embedded.
      try { await supabase.auth.refreshSession(); } catch (_) { /* non-fatal */ }

      haptic.success();
      onSaved?.(nextAvatar, updData?.user || null);
      onClose();
    } catch (err) {
      console.error("[avatar] save failed", {
        stage: err?.stage,
        status: err?.status,
        code: err?.code,
        hint: err?.hint,
        message: err?.message,
        info: err?.info,
        err,
      });
      const tag = err?.code || err?.status ? ` (${err?.code || `HTTP ${err?.status}`})` : "";
      setError((t("avatar.err.save") || "No se pudo guardar. Intenta de nuevo.") + tag);
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
          <span className="sheet-title">
            {draft.kind === "cropping"
              ? (t("avatar.crop.title") || "Ajusta tu foto")
              : (t("avatar.title") || "Cambiar foto")}
          </span>
          <button className="sheet-close" aria-label={t("close") || "Cerrar"} onClick={onClose}>
            <IconX size={14} />
          </button>
        </div>

        {/* Cropping UI takes over the sheet body — replaces the preset
            grid + drop zone while the user is positioning their photo.
            Returning to the picker (Cancelar) restores the previous
            draft (whatever was saved before). */}
        {draft.kind === "cropping" && (
          <AvatarCropEditor
            file={draft.file}
            onCancel={onCropCancel}
            onConfirm={onCropConfirm}
          />
        )}

        {draft.kind !== "cropping" && (
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
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => { e.preventDefault(); setDropHover(true); }}
            onDragLeave={() => setDropHover(false)}
            onDrop={onDrop}
          >
            <div className="av-picker-drop-icon">
              <IconUpload size={16} />
            </div>
            <div className="av-picker-drop-title">
              {t("avatar.dropTitle") || "Sube tu propia foto"}
            </div>
            <div className="av-picker-drop-sub">
              {t("avatar.dropSub") || "JPG, PNG o HEIC. La recortas en círculo en el siguiente paso."}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
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
        )}
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
    let info = null;
    try { info = await res.clone().json(); }
    catch (_) { info = { text: await res.text().catch(() => "") }; }
    throw Object.assign(new Error(`put_${res.status}`), {
      stage: "put",
      status: res.status,
      code: info?.code || null,
      hint: info?.hint || info?.error || info?.text || null,
      info,
    });
  }
  return true;
}
