import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "../../utils/haptics";

/* ── Note autosave (extracted from NoteEditor, WS-6) ───────────────────
   Owns the debounced save lifecycle that was woven through NoteEditor:

     • a 800 ms debounce timer + the "saved | saving | dirty" indicator state
     • scheduleSave(title, content) — the per-keystroke debounced write,
       with a failure path that re-arms the pending args + toasts so the user
       knows autosave broke (the indicator stays "dirty")
     • an unmount flush — persists the last typed args if the editor is torn
       down mid-debounce (tablet split-view note switch swaps the note before
       the timer fires), so clinical writes aren't silently dropped
     • cancelPending() — clear the timer + drop the pending args, for paths
       that persist explicitly (close, version-restore) and must not let the
       flush double-write

   The hook reads the LATEST onSave/readOnly at fire time via a ref, so
   scheduleSave/cancelPending stay referentially stable. setSaveState is
   exposed for the explicit-save paths that drive the indicator directly. */

export interface AutosaveData { title: string; content: string }

export interface NoteAutosaveOptions {
  onSave: (data: AutosaveData) => Promise<unknown> | unknown;
  readOnly?: boolean;
  showToast?: (msg: string, type?: string) => void;
  /** Localized "no se pudo guardar" message shown on a failed autosave. */
  saveFailedMsg: string;
}

export function useNoteAutosave(opts: NoteAutosaveOptions) {
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving" | "dirty"
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the latest typed args while a debounced save is pending. Read on
  // unmount so a note switch mid-debounce doesn't drop the last ~800 ms.
  const pendingSaveArgs = useRef<AutosaveData | null>(null);

  // Latest options for the timer + unmount flush (which must use the current
  // onSave/readOnly, not the ones captured when the timer was armed).
  const latest = useRef(opts);
  useEffect(() => { latest.current = opts; });

  const scheduleSave = useCallback((title: string, content: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSaveArgs.current = { title, content };
    setSaveState("dirty");
    saveTimer.current = setTimeout(async () => {
      pendingSaveArgs.current = null;
      setSaveState("saving");
      try {
        await latest.current.onSave({ title, content });
        setSaveState("saved");
        haptic.success();
      } catch {
        // Don't flip back to "saved" silently — the user thinks their writes
        // are queued but autosave is broken. Toast it, leave the indicator
        // dirty, and re-arm pendingSaveArgs so unmount can still try.
        pendingSaveArgs.current = { title, content };
        setSaveState("dirty");
        haptic.warn();
        latest.current.showToast?.(latest.current.saveFailedMsg, "error");
      }
    }, 800);
  }, []);

  // Clear the debounce + drop the pending args, for paths that persist
  // explicitly (close / version-restore) and must not let the flush re-write.
  const cancelPending = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSaveArgs.current = null;
  }, []);

  // Flush any pending typed content on unmount. Fire-and-forget; if it fails
  // the user still has the dirty indicator + toast path on next mount.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const pending = pendingSaveArgs.current;
    if (pending && !latest.current.readOnly) {
      pendingSaveArgs.current = null;
      const fn = latest.current.onSave;
      if (fn) {
        try { Promise.resolve(fn(pending)).catch(() => {}); } catch { /* ignore */ }
      }
    }
  }, []);

  return { saveState, setSaveState, scheduleSave, cancelPending };
}
