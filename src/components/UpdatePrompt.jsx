import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";
import { useIdle } from "../hooks/useIdle";

/* ── Update prompt ────────────────────────────────────────────────────
   Pipeline (driven by main.jsx's SW lifecycle wiring):

     main.jsx detects waiting SW → dispatches 'cardigan-update-ready'
       with the SW as detail → this component picks it up.

   States:
     null       — no pending update
     deferred   — user tapped "Más tarde" recently; suppressed until
                  cardigan.updateDeferredUntil
     available  — pill rendered with Actualizar / Más tarde
     applying   — postMessage SKIP_WAITING fired; waiting on
                  controllerchange (handled in main.jsx)
     stuck      — applying took >4s; show retry / continue UI

   Smart auto-apply:
     If the SW becomes available AND no overlay is open AND no input
     is dirty AND the user has been idle ≥30s, we apply silently —
     the controllerchange listener in main.jsx reloads the page. The
     user sees a "Actualizado correctamente" toast on the next render
     (via App.jsx, gated on a localStorage flag we set right before
     the postMessage).

   Position:
     Bottom-right corner pill. Less intrusive than the previous
     full-width top toast — matches the convention modern apps
     (Slack, Linear, Notion) settled on for "soft" notifications. */

const DEFER_MS = 60 * 60 * 1000;          // 1h
const STUCK_AFTER_MS = 4_000;              // applying → stuck
const HARD_RELOAD_AFTER_STUCK_MS = 15_000; // stuck → forced reload (last resort)
const APPLIED_FLAG_KEY = "cardigan.updateAppliedAt";
const DEFER_KEY = "cardigan.updateDeferredUntil";

/* Quick scan — true if any input/textarea has user-entered text.
   Mirrors the "would the user lose work on a reload" check the
   reload semantics need. We treat focused inputs as dirty too:
   the user just clicked into a field and the reload would dump
   the cursor. */
function anyDirtyInput() {
  if (typeof document === "undefined") return false;
  const els = document.querySelectorAll("input:not([type=hidden]), textarea, [contenteditable='true']");
  for (const el of els) {
    if (document.activeElement === el) return true;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const val = el.value;
      if (val && val !== el.defaultValue) return true;
    } else if (el.isContentEditable) {
      if ((el.textContent || "").trim().length > 0) return true;
    }
  }
  return false;
}

function anyOverlayOpen() {
  if (typeof document === "undefined") return false;
  return document.querySelectorAll(".sheet-overlay, .confirm-dialog-overlay, .drawer-overlay").length > 0;
}

function getDeferredUntil() {
  try {
    const raw = localStorage.getItem(DEFER_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}

function setDeferredUntil(ts) {
  try { localStorage.setItem(DEFER_KEY, String(ts)); } catch { /* fall through */ }
}

function clearDeferredUntil() {
  try { localStorage.removeItem(DEFER_KEY); } catch { /* fall through */ }
}

function markUpdateApplied() {
  try { localStorage.setItem(APPLIED_FLAG_KEY, String(Date.now())); } catch { /* fall through */ }
}

export function UpdatePrompt() {
  const { t } = useT();
  const [waitingSW, setWaitingSW] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | available | applying | stuck
  const [deferredUntil, setDeferredUntilState] = useState(() => getDeferredUntil());
  const stuckTimerRef = useRef(null);
  const reloadFailsafeRef = useRef(null);
  const isIdle = useIdle(30_000);

  // Pick up the waiting SW from main.jsx.
  useEffect(() => {
    const onReady = (e) => setWaitingSW(e.detail || null);
    window.addEventListener("cardigan-update-ready", onReady);
    return () => window.removeEventListener("cardigan-update-ready", onReady);
  }, []);

  /* Apply the pending update. Auto-apply uses this with no haptic;
     manual "Actualizar" tap fires haptic.tap() before calling. */
  const applyUpdate = useCallback(() => {
    if (!waitingSW) return;
    setPhase("applying");
    markUpdateApplied();
    try { waitingSW.postMessage({ type: "SKIP_WAITING" }); }
    catch { /* SW gone — failsafe will reload below. */ }
    if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
    stuckTimerRef.current = setTimeout(() => {
      setPhase("stuck");
      // Last-resort hard reload — if the SW activation never fires
      // controllerchange (rare but observed). The user sees the
      // stuck UI for HARD_RELOAD_AFTER_STUCK_MS ms first so they
      // can hit Reintentar; if they do nothing, we force-reload.
      if (reloadFailsafeRef.current) clearTimeout(reloadFailsafeRef.current);
      reloadFailsafeRef.current = setTimeout(() => {
        try { window.location.reload(); } catch { /* tab gone */ }
      }, HARD_RELOAD_AFTER_STUCK_MS);
    }, STUCK_AFTER_MS);
  }, [waitingSW]);

  // Drive the phase machine when a waiting SW appears. Both branches
  // call setState synchronously inside the effect — that's the
  // intended behaviour (the effect IS the state machine driver), so
  // we silence the lint rule here. applyUpdate's setPhase("applying")
  // is the same shape and is similarly intentional.
  useEffect(() => {
    if (!waitingSW) return;
    if (phase !== "idle" && phase !== "available") return;
    const now = Date.now();
    // Honour the deferral.
    if (deferredUntil && now < deferredUntil) return;
    // Auto-apply if conditions are met. This re-evaluates whenever
    // isIdle flips — so a user who eventually walks away still gets
    // a silent refresh without seeing the prompt at all. Both
    // branches set state synchronously (applyUpdate → setPhase
    // internally, the explicit setPhase below) — that's the
    // intentional behaviour, the effect IS the state-machine driver.
    if (isIdle && !anyDirtyInput() && !anyOverlayOpen()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      applyUpdate();
      return;
    }
    setPhase("available");
  }, [waitingSW, phase, deferredUntil, isIdle, applyUpdate]);

  // Cleanup timers on unmount.
  useEffect(() => () => {
    if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
    if (reloadFailsafeRef.current) clearTimeout(reloadFailsafeRef.current);
  }, []);

  const handleApply = () => {
    haptic.tap();
    applyUpdate();
  };

  const handleDefer = () => {
    haptic.tap();
    const until = Date.now() + DEFER_MS;
    setDeferredUntil(until);
    setDeferredUntilState(until);
    setPhase("idle");
  };

  const handleRetry = () => {
    haptic.tap();
    if (reloadFailsafeRef.current) {
      clearTimeout(reloadFailsafeRef.current);
      reloadFailsafeRef.current = null;
    }
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
    applyUpdate();
  };

  const handleContinueAnyway = () => {
    haptic.tap();
    if (reloadFailsafeRef.current) {
      clearTimeout(reloadFailsafeRef.current);
      reloadFailsafeRef.current = null;
    }
    // Drop the apply mark — we're staying on the old version
    // intentionally and don't want to show a "Actualizado" confirmation
    // on a future organic reload.
    try { localStorage.removeItem(APPLIED_FLAG_KEY); } catch { /* fall through */ }
    clearDeferredUntil();
    setPhase("idle");
    setWaitingSW(null);
  };

  if (!waitingSW) return null;
  if (phase === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: "calc(env(safe-area-inset-right, 0px) + 12px)",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        zIndex: "var(--z-install)",
        maxWidth: 380,
        animation: "toastIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}>
      <div className="update-prompt-toast">
        <div style={{ flex: 1, minWidth: 0 }}>
          {phase === "stuck" ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{t("update.stuckTitle")}</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>{t("update.stuckBody")}</div>
            </>
          ) : phase === "applying" ? (
            <span>{t("update.applying")}</span>
          ) : (
            <span>{t("updateAvailable")}</span>
          )}
        </div>

        {phase === "stuck" ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="update-prompt-action update-prompt-action--ghost"
              onClick={handleContinueAnyway}>
              {t("update.continueAnyway")}
            </button>
            <button
              type="button"
              className="update-prompt-action"
              onClick={handleRetry}>
              {t("update.retry")}
            </button>
          </div>
        ) : phase === "applying" ? (
          <button
            type="button"
            className="update-prompt-action is-applying"
            disabled>
            <span className="update-prompt-spinner" aria-hidden="true" />
            <span>{t("updateNow")}</span>
          </button>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              className="update-prompt-action update-prompt-action--ghost"
              onClick={handleDefer}>
              {t("update.later")}
            </button>
            <button
              type="button"
              className="update-prompt-action"
              onClick={handleApply}>
              {t("updateNow")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Detect "we just reloaded after applying an update" and surface a
   confirmation toast. Called once at app boot from App.jsx — see
   the showSuccess wiring there. Returns the message to surface, or
   null if no recent apply. Co-located with the component because
   they share the localStorage flag conventions; the fast-refresh
   rule complains about mixed exports but the indirection of a
   separate file isn't worth the maintenance overhead. */
// eslint-disable-next-line react-refresh/only-export-components
export function consumePostUpdateToast() {
  if (typeof window === "undefined") return null;
  let stamp = 0;
  try { stamp = parseInt(localStorage.getItem(APPLIED_FLAG_KEY) || "0", 10); }
  catch { return null; }
  if (!stamp || !Number.isFinite(stamp)) return null;
  // 30s window — wide enough to cover a slow SW activation but
  // narrow enough that a stale flag from a crashed apply doesn't
  // pop a confusing toast hours later.
  if (Date.now() - stamp > 30_000) {
    try { localStorage.removeItem(APPLIED_FLAG_KEY); } catch { /* fall through */ }
    return null;
  }
  try { localStorage.removeItem(APPLIED_FLAG_KEY); } catch { /* fall through */ }
  // Also clear any deferral — user just took the update, don't
  // re-defer the next one based on a stale 1h window.
  try { localStorage.removeItem(DEFER_KEY); } catch { /* fall through */ }
  return "Actualizado correctamente";
}
