import { forwardRef, useEffect, useId, useImperativeHandle, useRef } from "react";

/* ── Cloudflare Turnstile widget ──
   Renders a Turnstile challenge that produces a single-use token,
   then hands it to the parent via `onToken`. The token is consumed by
   useAuth's signIn / signUp / resetPassword paths and verified server-
   side by Supabase Auth (via security_captcha_secret).

   Renders nothing when VITE_TURNSTILE_SITE_KEY is unset — graceful
   degradation so dev builds and pre-rollout deploys keep working
   exactly as today. Once the env var ships AND Supabase's
   security_captcha_enabled is flipped on, the widget becomes
   mandatory and the calling form gates submit on `token != null`.

   We load the script once per page lifecycle using a small module-
   level promise so multiple widget instances (signin AND signup
   visible simultaneously? unlikely but possible) share a single
   <script> tag. */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";

let scriptPromise = null;
function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") { reject(new Error("no window")); return; }
    if (window.turnstile) { resolve(window.turnstile); return; }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => reject(new Error("Turnstile script failed to load"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export const TurnstileWidget = forwardRef(function TurnstileWidget({ onToken, theme = "auto" }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenRef = useRef(onToken);
  const containerId = useId();
  // Keep the latest onToken in a ref so the script-load effect doesn't
  // need to re-run when the parent passes a new closure each render.
  useEffect(() => { onTokenRef.current = onToken; }, [onToken]);

  /* Imperative handle: parents call ref.current?.reset() after a token
     has been consumed by a submit. Without this the widget holds the
     issued token until natural expiry (~5 min for managed mode), so
     subsequent submits look "stuck verifying" while the React state is
     null and the widget doesn't realise it should reissue. */
  useImperativeHandle(ref, () => ({
    reset() {
      const wid = widgetIdRef.current;
      if (wid != null && window.turnstile?.reset) {
        try { window.turnstile.reset(wid); } catch { /* widget already gone */ }
      }
    },
  }), []);

  useEffect(() => {
    if (!SITE_KEY) return; // env not wired — render nothing
    let cancelled = false;
    loadScript().then((turnstile) => {
      if (cancelled || !containerRef.current) return;
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        theme,
        // appearance:"interaction-only" hides the widget when no
        // user interaction is required — the typical case for trusted
        // browsers in managed mode. Avoids the "I never touched it but
        // it's already verified" confusion users were reporting and
        // removes the iframe from the layout (so iOS Safari's keyboard
        // doesn't have to reflow around it on every focus change).
        appearance: "interaction-only",
        callback: (token) => onTokenRef.current?.(token),
        "error-callback": () => onTokenRef.current?.(null),
        "expired-callback": () => onTokenRef.current?.(null),
        // "timeout-callback" — Turnstile auto-refreshes on timeout, but
        // surface a null in the meantime so the form button greys out.
        "timeout-callback": () => onTokenRef.current?.(null),
      });
    }).catch(() => {
      // Script failed to load (network / CSP). Don't block the form —
      // the server will reject without a token if captcha is required.
      onTokenRef.current?.(null);
    });
    return () => {
      cancelled = true;
      const wid = widgetIdRef.current;
      if (wid != null && window.turnstile?.remove) {
        try { window.turnstile.remove(wid); } catch { /* widget already gone */ }
      }
      widgetIdRef.current = null;
    };
  }, [theme]);

  if (!SITE_KEY) return null;
  return <div ref={containerRef} id={`ts-${containerId}`} />;
});

/** Whether Turnstile is configured (parent forms can branch UI on this). */
export const TURNSTILE_ENABLED = !!SITE_KEY;
