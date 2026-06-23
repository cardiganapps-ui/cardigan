import { lazy, Suspense } from "react";
import ConsentBanner from "../ConsentBanner";

/* ── AppOverlays ──────────────────────────────────────────────────────
   The app-level overlay/prompt layer that used to render inline at the
   top of AppShell's tree (between the skip-link and the Drawer). These
   are global, screen-independent surfaces: the LFPDPPP consent gate, the
   note-encryption unlock gate, the five engagement prompts (welcome-pro /
   trial reminder / passkey nudge / subscription success), the Pro-upgrade
   sheet, Cardi + Inbox sheets, and the milestone / activation / rating /
   share-folder surfaces.

   PRESENTATIONAL extraction: every open-flag + handler is owned by
   AppShell (most come out of useEngagementPrompts) and threads in as
   props, so the JSX moved verbatim. The lazy() chunk declarations move
   with the JSX that uses them, so AppShell stops carrying ~140 lines of
   modal wiring and the overlay bundle splits cleanly.

   Rendered INSIDE CardiganProvider (same position as before), so the
   lazy sheets keep their context access. */

const EncryptionUnlockGate = lazy(() => import("../EncryptionUnlockGate"));
const SubscriptionWelcome = lazy(() => import("../SubscriptionWelcome"));
const MilestoneCelebration = lazy(() => import("../MilestoneCelebration").then(m => ({ default: m.MilestoneCelebration })));
const ActivationCompleteShareSheet = lazy(() => import("../ActivationCompleteShareSheet").then(m => ({ default: m.ActivationCompleteShareSheet })));
const RatingSheet = lazy(() => import("../RatingSheet").then(m => ({ default: m.RatingSheet })));
const ShareFolderSheet = lazy(() => import("../sheets/ShareFolderSheet").then(m => ({ default: m.ShareFolderSheet })));
const StripePaymentSheet = lazy(() => import("../StripePaymentSheet"));
const ProUpgradeSheet = lazy(() => import("../ProUpgradeSheet").then(m => ({ default: m.ProUpgradeSheet })));
const CardiSheet = lazy(() => import("../sheets/CardiSheet").then(m => ({ default: m.CardiSheet })));
const InboxSheet = lazy(() => import("../sheets/InboxSheet").then(m => ({ default: m.InboxSheet })));
const TrialReminderPrompt = lazy(() => import("../TrialReminderPrompt"));
const PasskeyEnrollPrompt = lazy(() => import("../PasskeyEnrollPrompt"));
const SubscriptionSuccess = lazy(() => import("../SubscriptionSuccess").then(m => ({ default: m.SubscriptionSuccess })));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface AppOverlaysProps {
  demo?: boolean;
  readOnly?: boolean;
  user: Row;
  viewAsUserId?: string | null;
  noteCrypto: Row;
  cryptoGateDismissed: boolean;
  setCryptoGateDismissed: (v: boolean) => void;
  subscription: Row;
  welcomeProOpen: boolean;
  closeWelcomePro: () => void;
  subscribeFromWelcomePro: () => void;
  welcomePaymentOpen: boolean;
  setWelcomePaymentOpen: (v: boolean) => void;
  proSheetOpen: boolean;
  proSheetFeature: string | null;
  setProSheetOpen: (v: boolean) => void;
  cardiOpen: boolean;
  setCardiOpen: (v: boolean) => void;
  inboxOpen: boolean;
  setInboxOpen: (v: boolean) => void;
  trialReminderOpen: boolean;
  trialReminderDays: number | null;
  subscribeFromTrialReminder: () => void;
  setTrialReminderOpen: (v: boolean) => void;
  passkeyPromptOpen: boolean;
  passkeyCreating: boolean;
  createPasskeyFromPrompt: () => void;
  dismissPasskeyPrompt: () => void;
  trialReminderPaymentOpen: boolean;
  setTrialReminderPaymentOpen: (v: boolean) => void;
  subscriptionSuccessOpen: boolean;
  closeSubscriptionSuccess: () => void;
  activationShareOpen: boolean;
  setActivationShareOpen: (v: boolean) => void;
  ratingSheetOpen: boolean;
  setRatingSheetOpen: (v: boolean) => void;
  shareFolderUrl: string | null;
  setShareFolderUrl: (v: string | null) => void;
  showSuccess: (msg: string) => void;
  t: (key: string) => string;
}

export function AppOverlays(props: AppOverlaysProps) {
  const {
    demo, readOnly, user, viewAsUserId,
    noteCrypto, cryptoGateDismissed, setCryptoGateDismissed,
    subscription,
    welcomeProOpen, closeWelcomePro, subscribeFromWelcomePro,
    welcomePaymentOpen, setWelcomePaymentOpen,
    proSheetOpen, proSheetFeature, setProSheetOpen,
    cardiOpen, setCardiOpen,
    inboxOpen, setInboxOpen,
    trialReminderOpen, trialReminderDays, subscribeFromTrialReminder, setTrialReminderOpen,
    passkeyPromptOpen, passkeyCreating, createPasskeyFromPrompt, dismissPasskeyPrompt,
    trialReminderPaymentOpen, setTrialReminderPaymentOpen,
    subscriptionSuccessOpen, closeSubscriptionSuccess,
    activationShareOpen, setActivationShareOpen,
    ratingSheetOpen, setRatingSheetOpen,
    shareFolderUrl, setShareFolderUrl,
    showSuccess, t,
  } = props;
  return (
    <>
      {/* LFPDPPP consent gate — blocks the app on first login or after a
          policy version bump. Skipped in demo mode (no real user) and
          in admin "view as user" mode (read-only). */}
      {!demo && !readOnly && user && <ConsentBanner user={user} />}
      {!demo && !readOnly && user && !cryptoGateDismissed && (
        <Suspense fallback={null}>
          <EncryptionUnlockGate noteCrypto={noteCrypto} onSkip={() => setCryptoGateDismissed(true)} />
        </Suspense>
      )}
      {welcomeProOpen && (
        <Suspense fallback={null}>
          <SubscriptionWelcome
            daysLeftInTrial={subscription.daysLeftInTrial ?? undefined}
            onContinue={closeWelcomePro}
            onSubscribe={subscribeFromWelcomePro}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        {welcomePaymentOpen && (
          <StripePaymentSheet
            open={welcomePaymentOpen}
            daysLeftInTrial={subscription.daysLeftInTrial ?? undefined}
            onClose={() => setWelcomePaymentOpen(false)}
            onSuccess={() => {
              setWelcomePaymentOpen(false);
              showSuccess(t("subscription.toastSubscribed"));
            }}
          />
        )}
      </Suspense>
      {/* Pro feature upgrade prompt — opens whenever a non-Pro user
          tries to use a gated feature. Centralized here so any screen
          can trigger via `requirePro(featureKey)` from context. */}
      <Suspense fallback={null}>
        {proSheetOpen && (
          <ProUpgradeSheet
            open={proSheetOpen}
            feature={proSheetFeature ?? undefined}
            onClose={() => setProSheetOpen(false)}
          />
        )}
      </Suspense>
      {/* Cardi — in-app navigation/help chatbot. Lazy-loaded so the
          @anthropic-ai/sdk-powered hook + the sheet bundle only ship
          when the user actually opens the chat. */}
      <Suspense fallback={null}>
        {cardiOpen && (
          <CardiSheet open={cardiOpen} onClose={() => setCardiOpen(false)} />
        )}
      </Suspense>
      {/* In-app notification inbox — bell in the topbar opens it. Lazy so
          the sheet bundle only ships when first opened. */}
      <Suspense fallback={null}>
        {inboxOpen && <InboxSheet onClose={() => setInboxOpen(false)} />}
      </Suspense>
      {/* Trial reminder — fires once per day at 15/10/5/3/2/1 days left.
          The dedicated payment sheet next to it stays mounted so the
          subscribe path keeps working even after the reminder closes. */}
      <Suspense fallback={null}>
        {trialReminderOpen && (
          <TrialReminderPrompt
            open={trialReminderOpen}
            daysLeft={trialReminderDays ?? undefined}
            onSubscribe={subscribeFromTrialReminder}
            onDismiss={() => setTrialReminderOpen(false)}
          />
        )}
        {passkeyPromptOpen && (
          <PasskeyEnrollPrompt
            open={passkeyPromptOpen}
            creating={passkeyCreating}
            onCreate={createPasskeyFromPrompt}
            onDismiss={dismissPasskeyPrompt}
          />
        )}
        {trialReminderPaymentOpen && (
          <StripePaymentSheet
            open={trialReminderPaymentOpen}
            daysLeftInTrial={subscription.daysLeftInTrial ?? undefined}
            onClose={() => setTrialReminderPaymentOpen(false)}
            onSuccess={() => {
              setTrialReminderPaymentOpen(false);
              showSuccess(t("subscription.toastSubscribed"));
            }}
          />
        )}
        {subscriptionSuccessOpen && (
          <SubscriptionSuccess
            open={subscriptionSuccessOpen}
            onClose={closeSubscriptionSuccess}
          />
        )}
      </Suspense>
      {/* 0→1 first-patient / first-session / first-payment celebration.
          No UI of its own — fires success toasts via context.
          Skipped in demo + admin-view-as flows by passing accessState. */}
      {!demo && !viewAsUserId && user && (
        <Suspense fallback={null}>
          <MilestoneCelebration
            userId={user.id}
            accessState={subscription.accessState}
          />
        </Suspense>
      )}
      {/* Opens after the user crosses all 4 activation steps (the
          ActivationChecklist fires this via openActivationShareSheet
          on its own bonus-grant path). The sheet is lazy in the
          sense that the state stays false until that single
          transition — no rendering cost on the steady state. */}
      {!demo && !readOnly && user && (
        <Suspense fallback={null}>
          <ActivationCompleteShareSheet
            open={activationShareOpen}
            onClose={() => setActivationShareOpen(false)}
            code={subscription?.referralInfo?.code || undefined}
          />
        </Suspense>
      )}
      {/* In-app rating sheet — driven either by the #rating hash
          (email deep-link) or the organic day-14 eligibility check
          above. Hidden in demo + read-only modes. */}
      {!demo && !readOnly && user && (
        <Suspense fallback={null}>
          <RatingSheet
            open={ratingSheetOpen}
            onClose={() => setRatingSheetOpen(false)}
            promptKind="day14_v1"
            userId={user.id}
          />
        </Suspense>
      )}
      {/* PWA Web Share Target receiver — only mounts when a share
          arrived (shareFolderUrl set by the URL-param effect). The
          sheet itself handles the "URL didn't parse" case so we
          don't need to validate here. */}
      {!demo && !readOnly && user && shareFolderUrl && (
        <Suspense fallback={null}>
          <ShareFolderSheet
            open={!!shareFolderUrl}
            url={shareFolderUrl}
            onClose={() => setShareFolderUrl(null)}
          />
        </Suspense>
      )}
    </>
  );
}
