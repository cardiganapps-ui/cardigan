import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  encryptNote,
  decryptNote,
  generateMasterKeyBytes,
  wrapMasterWithPassphrase,
  wrapMasterWithRecovery,
  unwrapMasterWithPassphrase,
} from "../lib/cryptoNotes";

/* ── useNoteCrypto ───────────────────────────────────────────────────
   State machine for the optional client-side note encryption feature.

     loading  — checking server status (fetch /api/encryption)
     disabled — user has not opted in. encrypt()/decrypt() are no-ops;
                notes stay plaintext on the wire.
     locked   — user opted in but hasn't entered passphrase yet this
                session. encrypted notes render as "[cifrado]" until
                they unlock.
     unlocked — master key in memory; encrypt/decrypt work.

   The master key lives in a useRef and is cleared on lock(). It is
   never persisted — even sessionStorage would expose it to XSS. The
   trade-off is that closing/reopening the tab requires re-entering
   the passphrase, which is the same security model 1Password and
   similar tools use for short-lived sessions.

   The recovery path (server-held private key) is implemented via the
   /api/admin-recover-encryption endpoint and is invisible from this
   hook's public surface — it's purely an admin tool. */

const RECOVERY_KID = "v1";

async function authedFetch(path, init = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("No active session");
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    let msg = "Request failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* keep default */ }
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export function useNoteCrypto({ user } = {}) {
  const [status, setStatus] = useState(user ? "loading" : "disabled");
  const [error, setError] = useState("");
  // Holds the user's wrap metadata (passphrase wrap, salt, iv, iters).
  // Refreshed from the server when the user enables encryption or on
  // mount when status comes back as "locked".
  const wrapRef = useRef(null);
  // Master key bytes (32) when unlocked. Cleared on lock().
  const masterKeyRef = useRef(null);

  const refreshStatus = useCallback(async () => {
    if (!user) { setStatus("disabled"); return; }
    setStatus("loading");
    try {
      const j = await authedFetch("/api/encryption");
      if (j.enabled) {
        wrapRef.current = {
          passphrase_wrap: j.passphrase_wrap,
          passphrase_salt: j.passphrase_salt,
          passphrase_iv: j.passphrase_iv,
          passphrase_iters: j.passphrase_iters,
        };
        setStatus("locked");
      } else {
        wrapRef.current = null;
        setStatus("disabled");
      }
      setError("");
    } catch (err) {
      setError(err.message || "Status unavailable");
      setStatus("disabled");
    }
  }, [user]);

  // refreshStatus self-bootstraps "loading" → "locked|disabled" once
  // per user. Standard subscribe-to-external-system on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // ── Setup ─────────────────────────────────────────────────────────
  const setup = useCallback(async (passphrase) => {
    setError("");
    if (!passphrase || passphrase.length < 8) {
      setError("Tu contraseña debe tener al menos 8 caracteres.");
      return false;
    }
    const recoveryPub = import.meta.env.VITE_NOTES_RECOVERY_PUBLIC_KEY;
    if (!recoveryPub) {
      setError("Cifrado no configurado en este servidor.");
      return false;
    }
    try {
      const masterKey = generateMasterKeyBytes();
      const passphraseWrap = await wrapMasterWithPassphrase(masterKey, passphrase);
      const recoveryWrap = await wrapMasterWithRecovery(masterKey, recoveryPub);

      await authedFetch("/api/encryption", {
        method: "POST",
        body: JSON.stringify({
          ...passphraseWrap,
          recovery_wrap: recoveryWrap,
          recovery_kid: RECOVERY_KID,
        }),
      });

      // Stay unlocked after setup so the very next note can encrypt
      // without an extra prompt.
      wrapRef.current = passphraseWrap;
      masterKeyRef.current = masterKey;
      setStatus("unlocked");
      return true;
    } catch (err) {
      setError(err.message || "Setup failed");
      return false;
    }
  }, []);

  // ── Unlock ────────────────────────────────────────────────────────
  const unlock = useCallback(async (passphrase) => {
    setError("");
    if (!wrapRef.current) {
      // No wrap loaded — re-fetch first.
      await refreshStatus();
    }
    if (!wrapRef.current) {
      setError("Cifrado no disponible.");
      return false;
    }
    try {
      const master = await unwrapMasterWithPassphrase({
        passphrase,
        ...wrapRef.current,
      });
      masterKeyRef.current = master;
      setStatus("unlocked");
      return true;
    } catch (err) {
      setError(err.code === "bad_passphrase" ? "Contraseña incorrecta." : (err.message || "Unlock failed"));
      return false;
    }
  }, [refreshStatus]);

  const lock = useCallback(() => {
    // Best-effort wipe — the GC will reclaim, but overwriting first
    // means a heap snapshot taken later won't yield the key.
    if (masterKeyRef.current) {
      masterKeyRef.current.fill(0);
      masterKeyRef.current = null;
    }
    if (wrapRef.current) setStatus("locked");
  }, []);

  // ── Disable ──────────────────────────────────────────────────────
  // Removes the wrap row. Encrypted notes stay encrypted in the DB
  // and become permanently unreadable unless the user re-enables with
  // the same master key (which they no longer have). The Settings
  // confirm flow warns about this loudly.
  const disable = useCallback(async () => {
    setError("");
    try {
      await authedFetch("/api/encryption", { method: "DELETE" });
      lock();
      wrapRef.current = null;
      setStatus("disabled");
      return true;
    } catch (err) {
      setError(err.message || "Disable failed");
      return false;
    }
  }, [lock]);

  // ── Change passphrase ────────────────────────────────────────────
  // Re-wraps the in-memory master key under a new passphrase. Requires
  // unlocked state — we don't trust callers to supply the old
  // passphrase (they might be wrong; the in-memory key is the source
  // of truth at this point).
  const changePassphrase = useCallback(async (newPassphrase) => {
    setError("");
    if (status !== "unlocked" || !masterKeyRef.current) {
      setError("Desbloquea primero.");
      return false;
    }
    if (!newPassphrase || newPassphrase.length < 8) {
      setError("Tu contraseña debe tener al menos 8 caracteres.");
      return false;
    }
    try {
      const passphraseWrap = await wrapMasterWithPassphrase(masterKeyRef.current, newPassphrase);
      await authedFetch("/api/encryption", {
        method: "PUT",
        body: JSON.stringify(passphraseWrap),
      });
      wrapRef.current = passphraseWrap;
      return true;
    } catch (err) {
      setError(err.message || "Rewrap failed");
      return false;
    }
  }, [status]);

  // ── Per-note encrypt/decrypt ────────────────────────────────────
  // These are stable across renders so they can be passed as deps to
  // memoised callers (createNoteActions, fetch path).
  const encrypt = useCallback(async (plaintext) => {
    if (status !== "unlocked" || !masterKeyRef.current) {
      return { content: plaintext, encrypted: false };
    }
    const ct = await encryptNote(plaintext || "", masterKeyRef.current);
    return { content: ct, encrypted: true };
  }, [status]);

  const decrypt = useCallback(async (content, encrypted) => {
    if (!encrypted) return content;
    if (status !== "unlocked" || !masterKeyRef.current) return null;
    try {
      return await decryptNote(content, masterKeyRef.current);
    } catch {
      return null;
    }
  }, [status]);

  return {
    status,
    error,
    canEncrypt: status === "unlocked",
    isEnabled: status !== "loading" && status !== "disabled",
    setup,
    unlock,
    lock,
    disable,
    changePassphrase,
    encrypt,
    decrypt,
    refreshStatus,
  };
}
