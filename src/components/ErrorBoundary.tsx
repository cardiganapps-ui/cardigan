import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { captureException } from "../lib/sentry";

/* Detect "the lazy chunk URL changed under us" errors. After a
   deploy, an open tab still holds the old index.html in memory; a
   later React.lazy import resolves to a chunk URL that no longer
   exists in the new build (Vite hashes the filenames). The error
   surfaces as one of these messages depending on browser:
     - Chrome / iOS Safari: "Failed to fetch dynamically imported module: /assets/Foo-ABC.js"
     - Firefox: "error loading dynamically imported module"
     - Webpack-built sites: "Loading chunk N failed"
   Recovery is a hard reload (with cache-busting): the new index.html
   pulls in the fresh chunk hashes and everything works again. */
function isChunkLoadError(err?: { name?: string; message?: string } | null) {
  if (!err) return false;
  const name = err.name || "";
  const msg = err.message || "";
  if (name === "ChunkLoadError") return true;
  return /failed to fetch dynamically imported module/i.test(msg)
      || /error loading dynamically imported module/i.test(msg)
      || /loading chunk \S+ failed/i.test(msg)
      || /importing a module script failed/i.test(msg);
}

const RELOAD_FLAG = "cardigan.errorboundary.reloaded";

/* Wipe potentially-corrupt local state on a render crash. The
   stale-while-revalidate cache from src/lib/dataCache.js is the
   most likely culprit when a deploy ships a row-shape change that
   the in-memory data uses but the cached snapshot doesn't (or vice
   versa). Wiping it forces the next render path to fetch fresh
   from Supabase and rehydrate cleanly. Per-key removal so
   unrelated localStorage entries (theme, consent, encryption keys,
   tutorial flags) survive. */
/* When a render crash happens after a deploy, a fresh SW is often
   sitting in the "waiting" state (our SW intentionally waits for
   the UpdatePrompt toast to opt in). The crash short-circuits that
   flow — the user never sees the toast, taps Recargar, the OLD SW
   serves the OLD index.html + buggy JS, and they're stuck in a
   reload loop. Force-skip the waiting SW so the next navigation
   loads the new bundle. Falls through to a plain reload if there's
   no SW or no waiting worker. */
function activateWaitingSWThenReload() {
  const fallback = () => window.location.reload();
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    fallback();
    return;
  }
  navigator.serviceWorker.getRegistration().then(reg => {
    const waiting = reg?.waiting;
    if (!waiting) { fallback(); return; }
    // Wait for the new SW to take control, then reload onto the
    // fresh bundle. controllerchange fires once the activated SW
    // claims this client.
    const onChange = () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    waiting.postMessage({ type: "SKIP_WAITING" });
    // Safety net: if controllerchange doesn't fire within 1.5s,
    // reload anyway — better to attempt the old path than spin.
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      window.location.reload();
    }, 1500);
  }).catch(fallback);
}

function clearCorruptCaches() {
  if (typeof localStorage === "undefined") return;
  try {
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("cardigan.cache.v1.")) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // localStorage disabled / quota / private mode — nothing to do.
  }
}

/* Props:
   - children: the subtree to guard.
   - name: a stable label attached to the Sentry event so a per-screen
     boundary tells us WHICH screen crashed (e.g. "screen:finances").
   - inline: render a CONTAINED fallback (a card with "Reintentar")
     instead of the full-viewport one. Used when wrapping a single
     screen so the app shell (tabs, drawer) stays usable and one
     screen's crash doesn't blank the whole app. The retry resets the
     boundary in place rather than reloading. */
type ErrorBoundaryProps = {
  children?: ReactNode;
  name?: string;
  inline?: boolean;
};

export default class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean }> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Stale-deploy auto-recovery. Browser still holds the old
    // index.html in memory; a lazy import resolves to a chunk URL
    // that 404s. One reload (with the new index.html) fixes it.
    // Guarded by a sessionStorage flag so we don't loop on a real
    // error that happens to surface as a chunk-load message.
    if (isChunkLoadError(error) && typeof sessionStorage !== "undefined") {
      const alreadyTried = sessionStorage.getItem(RELOAD_FLAG);
      if (!alreadyTried) {
        try { sessionStorage.setItem(RELOAD_FLAG, "1"); } catch { /* ignore */ }
        // Drop the SWR cache too — if a row-shape mismatch is part
        // of the failure, the next render starts from a clean slate.
        clearCorruptCaches();
        // Bypass HTTP cache to guarantee the fresh index.html. The
        // ?v= query string is cosmetic; the important part is that
        // `location.reload(true)` (deprecated but still honored on
        // Safari) plus the cache-busting query forces a network hit.
        const url = new URL(window.location.href);
        url.searchParams.set("_r", Date.now().toString(36));
        window.location.replace(url.toString());
        return;
      }
    }
    // Buffered until the Sentry SDK loads (deferred to idle in
    // main.tsx). If a crash happens during the first ~100ms before
    // init, the event sits in the in-memory queue and flushes the
    // moment the SDK chunk lands.
    captureException(error, {
      extra: { componentStack: info?.componentStack, boundary: this.props.name || "root" },
    });
    // Clear the SWR cache as a defensive measure for non-chunk
    // crashes too — if cached data is malformed we don't want the
    // user trapped in a reload loop.
    clearCorruptCaches();
    // If there's a waiting SW (deploy just landed but the
    // UpdatePrompt toast was pre-empted by this crash), auto-skip
    // it and reload onto the new bundle once. The fresh code may
    // contain the fix. Guarded by sessionStorage so a real bug
    // present in BOTH old and new bundles doesn't loop.
    if (typeof sessionStorage !== "undefined" && typeof navigator !== "undefined" && navigator.serviceWorker) {
      const alreadyTried = sessionStorage.getItem(RELOAD_FLAG);
      if (!alreadyTried) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (reg?.waiting) {
            try { sessionStorage.setItem(RELOAD_FLAG, "1"); } catch { /* ignore */ }
            activateWaitingSWThenReload();
          }
        }).catch(() => { /* ignore */ });
      }
    }
  }

  handleReload = () => {
    // Manual reload — wipe the auto-reload sessionStorage flag too
    // so a subsequent stale-deploy crash can still self-heal.
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
    // If a new SW is waiting (deploy landed but the UpdatePrompt
    // toast never got to show because we crashed first), force it
    // to activate before reloading. Otherwise the reload goes
    // through the old SW + old precache and the bug re-fires.
    activateWaitingSWThenReload();
  };

  // In-place recovery for a contained (per-screen) boundary — clears
  // the error so the guarded subtree re-mounts. Cheaper and less
  // jarring than a full reload when only one screen failed.
  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Contained fallback — keeps the surrounding app shell alive.
    if (this.props.inline) {
      return (
        <div role="alert" style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          textAlign: "center",
          gap: 12,
          minHeight: 240,
        }}>
          <p style={{ maxWidth: 320, lineHeight: 1.5, margin: 0, color: "var(--charcoal-md, #555)" }}>
            No se pudo mostrar esta sección. Intenta de nuevo.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="btn btn-primary-teal"
          >
            Reintentar
          </button>
        </div>
      );
    }

    return (
      <div role="alert" style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        padding: 24,
        textAlign: "center",
        gap: 16,
        background: "var(--bg, #fff)",
        color: "var(--text, #222)",
      }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Algo salió mal</h1>
        <p style={{ maxWidth: 360, lineHeight: 1.5, margin: 0 }}>
          Ocurrió un error inesperado. Recarga la página para intentar de nuevo.
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            padding: "10px 20px",
            borderRadius: 999,
            border: "none",
            background: "var(--teal, #5B9BAF)",
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Recargar
        </button>
      </div>
    );
  }
}
