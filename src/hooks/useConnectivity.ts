import { useEffect, useState } from "react";

/* ── useConnectivity ─ tracks navigator.onLine and reports transitions.
   `online` is the current state. `lastChangedAt` is the wall-clock ms
   timestamp of the most recent transition — useful for the offline
   banner to render "X seconds ago" and for the queue replayer to
   schedule a delay before draining (let DNS settle).

   Default-true to avoid a flash of "Sin conexión" on first paint when
   navigator.onLine is briefly false during SSR-like edge cases.

   Note: navigator.onLine is a hint, not a guarantee. A device may
   report `online` while DNS is unreachable. The queue's drain handles
   the actual network outcome — this hook is purely for UI signaling.
*/
export function useConnectivity() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine !== false : true,
  );
  const [lastChangedAt, setLastChangedAt] = useState(() => Date.now());

  useEffect(() => {
    const onOnline = () => { setOnline(true); setLastChangedAt(Date.now()); };
    const onOffline = () => { setOnline(false); setLastChangedAt(Date.now()); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return { online, lastChangedAt };
}
