import { Component } from "react";
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
function isChunkLoadError(err) {
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

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
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
    // main.jsx). If a crash happens during the first ~100ms before
    // init, the event sits in the in-memory queue and flushes the
    // moment the SDK chunk lands.
    captureException(error, { extra: { componentStack: info?.componentStack } });
    // Clear the SWR cache as a defensive measure for non-chunk
    // crashes too — if cached data is malformed we don't want the
    // user trapped in a reload loop.
    clearCorruptCaches();
  }

  handleReload = () => {
    // Manual reload — wipe the auto-reload sessionStorage flag too
    // so a subsequent stale-deploy crash can still self-heal.
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
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
