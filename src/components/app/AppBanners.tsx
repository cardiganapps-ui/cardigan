import type { MutableRefObject } from "react";
import { isNative } from "../../lib/platform";

/* ── AppBanners ───────────────────────────────────────────────────────
   The stack of full-width status banners that sit at the top of the
   main-content column: demo, admin "view as user" read-only, trial
   expired, past-due (Stripe grace window), and trial-soon-to-expire.

   PRESENTATIONAL extraction from AppShell — all of the state these
   branch on (demo / viewAsUserId / subscription) is owned by AppShell
   and threads in as props, so the JSX moved verbatim. The OfflineBanner
   that followed this stack stays in AppShell (it's self-contained and
   reads its own hook). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface AppBannersProps {
  demo?: boolean;
  /* Signed-in user exploring via "Ver ejemplo" — exit CTA instead of
     the signup CTA. */
  demoHasAccount?: boolean;
  viewAsUserId?: string | null;
  subscription: Row;
  demoProfession: string;
  setDemoProfession: (v: string) => void;
  signOut: () => void;
  setViewAsUserId: (v: string | null) => void;
  viewAsOriginHashRef: MutableRefObject<string | null>;
  setScreen: (id: string) => void;
  navigate: (id: string) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export function AppBanners({
  demo, demoHasAccount, viewAsUserId, subscription,
  demoProfession, setDemoProfession, signOut,
  setViewAsUserId, viewAsOriginHashRef, setScreen, navigate, t,
}: AppBannersProps) {
  return (
    <>
      {/* Demo banner */}
      {demo && (
        <div className="app-banner app-banner--demo">
          <span className="app-banner-text">{t("demo.banner")}</span>
          {/* Profession picker — styled pill that wraps a native
              <select> so it inherits accessibility + mobile keyboard
              handling for free, but reads as a Cardigan chip rather
              than an OS dropdown. The chevron is rendered via CSS
              `background-image` on the pill so it stays in-frame on
              iOS where -webkit-appearance:none is partial. */}
          <label className="app-banner-picker" aria-label={t("onboarding.title")}>
            <span className="app-banner-picker-value">
              {t(`onboarding.professions.${demoProfession}.label`)}
            </span>
            <select
              className="app-banner-picker-select"
              value={demoProfession}
              onChange={(e) => setDemoProfession(e.target.value)}>
              <option value="psychologist">
                {t("onboarding.professions.psychologist.label")}
              </option>
              <option value="nutritionist">
                {t("onboarding.professions.nutritionist.label")}
              </option>
              <option value="tutor">
                {t("onboarding.professions.tutor.label")}
              </option>
              <option value="music_teacher">
                {t("onboarding.professions.music_teacher.label")}
              </option>
              <option value="trainer">
                {t("onboarding.professions.trainer.label")}
              </option>
            </select>
          </label>
          <button onClick={signOut} className="app-banner-action">
            {demoHasAccount ? t("demo.exitExample") : t("demo.createAccount")}
          </button>
        </div>
      )}

      {/* Read-only banner when viewing as another user */}
      {viewAsUserId && !demo && (
        <div className="app-banner app-banner--readonly">
          <span className="app-banner-text app-banner-text--muted">{t("admin.readOnly")}</span>
          <button onClick={() => {
            setViewAsUserId(null);
            // Return to the exact admin page the action was launched
            // from — typically #admin/users/<uid>, the user's
            // detail. Falls back to Home if there's no captured
            // origin (defensive against an admin hash that was
            // cleared mid-session).
            const origin = viewAsOriginHashRef.current;
            viewAsOriginHashRef.current = null;
            if (origin && origin.startsWith("#admin")) {
              if (typeof window !== "undefined") window.location.hash = origin;
              setScreen("admin");
            } else {
              setScreen("home");
            }
          }}
            className="app-banner-action app-banner-action--readonly">
            {t("admin.exit")}
          </button>
        </div>
      )}

      {/* Trial-expired banner — only when the trial has lapsed AND
          the user has no active Stripe subscription. Charcoal so it
          visually matches the read-only "view as user" banner — the
          user understands they've lost write access. CTA is the
          single accent-colored button on the strip, drawing the eye
          without screaming. */}
      {!demo && !viewAsUserId && subscription.accessExpired && (
        <div className="app-banner app-banner--expired">
          <span className="app-banner-text">
            {isNative()
              ? t("subscription.expiredBannerNative")
              : t("subscription.expiredBanner")}
          </span>
          {/* Native reader-app (iOS App Store + Google Play): no subscribe
              CTA. The banner copy above tells the user where to go without
              an in-app link. */}
          {!isNative() && (
            <button onClick={() => navigate("settings")} className="app-banner-action">
              {t("subscription.subscribeShort")}
            </button>
          )}
        </div>
      )}

      {/* Past-due banner — sub is in Stripe's grace window after a
          failed renewal. We keep Pro access (Stripe is retrying the
          card behind the scenes) but warn the user so they fix it
          before the grace window expires and access drops. */}
      {!demo && !viewAsUserId
        && subscription.subscription?.status === "past_due" && (
        <div className="app-banner app-banner--trial">
          <span className="app-banner-text">{t("subscription.pastDueBanner")}</span>
          <button onClick={() => navigate("settings")} className="app-banner-action">
            {t("subscription.fixPaymentShort")}
          </button>
        </div>
      )}

      {/* Trial-soon-to-expire banner — only when in the last 7 days
          of trial AND no active sub yet. Non-blocking; the user can
          keep using the app. The 7-day threshold matches typical
          SaaS "renewal nudge" cadence. The "Día N de 30" pill makes
          the urgency tangible without being shouty — users register
          "I'm on day 25" much more viscerally than "5 days left". */}
      {!demo && !viewAsUserId
        && subscription.accessState === "trial"
        && subscription.daysLeftInTrial != null
        && subscription.daysLeftInTrial <= 7
        && (
        <div className="app-banner app-banner--trial">
          <span className="app-banner-text" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.18)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}>
              {t("subscription.trialDayBadge", { n: Math.max(1, 30 - subscription.daysLeftInTrial + 1) })}
            </span>
            <span>
              {subscription.daysLeftInTrial <= 1
                ? t("subscription.trialEndsTodayBanner")
                : t("subscription.trialDaysLeftBanner", { n: subscription.daysLeftInTrial })}
            </span>
          </span>
          <button onClick={() => navigate("settings")} className="app-banner-action">
            {t("subscription.subscribeShort")}
          </button>
        </div>
      )}
    </>
  );
}
