import { useEffect, useState } from "react";
import { useMutationQueue } from "../hooks/useMutationQueue.js";

/* ── OfflineBanner ─ thin strip below the topbar that signals offline
   state + pending-queue count. Renders nothing in the common case
   (online with an empty queue). When offline, surfaces a persistent
   warning. When online with pending entries, shows progress + a
   "Reintentar" button — but ONLY after a debounce window so the
   normal write flow (every save enqueues a snapshot that drains in
   ~200ms) doesn't blink the banner on screen for everything.

   Debounce thresholds:
     • offline               → show immediately (user must know)
     • online + flushing     → show after 1.5s (don't flash for fast drains)
     • online + stuck queue  → show after 4s (true "something's wrong" signal)

   Sits above .main-content so it doesn't obscure FABs or sheets.
   Tokens-only — flips automatically in dark mode.

   No success-toast wiring: the banner's own headline transitions
   ("Sin conexión" → "Sincronizando…" → disappears) are the
   offline-recovery feedback. We previously bridged drain results
   to an App-level toast, but that fired on routine online enqueues
   too (snapshots, tag links) and overwhelmed the editor. */
export function OfflineBanner() {
  const { entries, online, flushing, flush } = useMutationQueue();
  const pending = entries.length;
  // `showSlow` only governs the delayed online+pending reveal. The
  // offline state shows directly in the render predicate below.
  const [showSlow, setShowSlow] = useState(false);

  // Reset showSlow as soon as the queue drains — adjust state during
  // render rather than in an effect (React-recommended for derived
  // state; sidesteps the set-state-in-effect rule).
  if (showSlow && pending === 0) setShowSlow(false);

  // Debounce the reveal so routine drains don't flash the banner.
  // notes.snapshot / tags / document updates all enqueue + drain in
  // sub-second windows — invisible to the user with a 1.5s/4s gate.
  useEffect(() => {
    if (!online || pending === 0) return;
    const delay = flushing ? 1500 : 4000;
    const t = setTimeout(() => setShowSlow(true), delay);
    return () => clearTimeout(t);
  }, [online, pending, flushing]);

  // Final visibility: offline state is always visible (user must
  // know); online state needs both pending entries AND the debounce
  // to have elapsed.
  const visible = !online || (pending > 0 && showSlow);
  if (!visible) return null;

  const isOffline = !online;
  const bg = isOffline ? "var(--amber-bg)" : "var(--teal-mist)";
  const fg = isOffline ? "var(--amber)" : "var(--teal-dark)";
  const border = isOffline ? "var(--amber)" : "var(--teal)";

  // Spanish copy is the canonical app voice. "X cambios pendientes" is
  // grammatically correct for any count including 1 (Spanish uses the
  // plural for "0 cambios" too).
  const headline = isOffline
    ? "Sin conexión"
    : flushing
      ? "Sincronizando…"
      : "Cambios pendientes";
  const sub = pending > 0
    ? `${pending} ${pending === 1 ? "cambio pendiente" : "cambios pendientes"}`
    : "Tus cambios se guardarán cuando vuelva la conexión.";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: bg,
        color: fg,
        borderBottom: `1px solid ${border}`,
        padding: "8px 14px",
        fontSize: 13,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        {headline}
        {pending > 0 && <span style={{ fontWeight: 500, marginLeft: 6 }}>· {sub}</span>}
      </span>
      {online && pending > 0 && !flushing && (
        <button
          type="button"
          onClick={flush}
          className="btn-tap"
          style={{
            background: "transparent",
            border: `1px solid ${border}`,
            color: fg,
            borderRadius: "var(--radius-pill)",
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
