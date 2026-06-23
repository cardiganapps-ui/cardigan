import { useEffect } from "react";
import { consumePostUpdateToast } from "../components/UpdatePrompt";

/* ── useForegroundToasts ──────────────────────────────────────────────
   Two app-level "surface a toast on a foreground signal" effects, lifted
   out of AppShell:

   1. Post-reload confirmation — UpdatePrompt stamps localStorage right
      before the service-worker reload; once the new build mounts we drain
      the stamp and show "Actualizado correctamente". consumePostUpdateToast
      returns null for organic reloads, so this is a no-op then.
   2. Native foreground push — the OS doesn't show the system tray banner
      while the app is foregrounded, so src/lib/nativePush relays the FCM
      payload via a `cardigan-native-push-received` CustomEvent and we
      surface it through the existing toast queue.

   Both are pure side-effect wiring over the toast channel; grouped here
   so AppShell stops owning the mount-once drain + the window listener. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface ForegroundToastsDeps {
  showSuccess: (msg: string) => void;
  showToast: (msg: string, kind?: string, opts?: Row) => void;
}

export function useForegroundToasts({ showSuccess, showToast }: ForegroundToastsDeps) {
  useEffect(() => {
    const msg = consumePostUpdateToast();
    if (msg) showSuccess(msg);
  // showSuccess is stable. Run once on mount only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail || {};
      const body = detail.body || detail.title || "Recordatorio";
      showToast(body, "info");
    };
    window.addEventListener("cardigan-native-push-received", handler);
    return () => window.removeEventListener("cardigan-native-push-received", handler);
  }, [showToast]);
}
