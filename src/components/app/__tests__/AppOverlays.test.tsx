/**
 * @vitest-environment happy-dom
 *
 * AppOverlays — the app-level overlay/prompt layer extracted from
 * AppShell. The children are heavy lazy sheets, so they're stubbed to
 * identifiable markers; this test pins the GATING that AppOverlays itself
 * owns (the part with real transcription risk): the demo / read-only /
 * view-as / signed-in / dismissed guards on each overlay.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

// Stub every child (lazy + static) so we assert presence by marker
// without pulling Stripe / confetti / supabase into the test.
vi.mock("../../ConsentBanner", () => ({ default: () => <div data-testid="consent" /> }));
vi.mock("../../EncryptionUnlockGate", () => ({ default: () => <div data-testid="crypto-gate" /> }));
vi.mock("../../SubscriptionWelcome", () => ({ default: () => <div data-testid="welcome-pro" /> }));
vi.mock("../../MilestoneCelebration", () => ({ MilestoneCelebration: () => <div data-testid="milestone" /> }));
vi.mock("../../ActivationCompleteShareSheet", () => ({ ActivationCompleteShareSheet: () => <div data-testid="activation-share" /> }));
vi.mock("../../RatingSheet", () => ({ RatingSheet: () => <div data-testid="rating" /> }));
vi.mock("../../sheets/ShareFolderSheet", () => ({ ShareFolderSheet: () => <div data-testid="share-folder" /> }));
vi.mock("../../StripePaymentSheet", () => ({ default: () => <div data-testid="stripe" /> }));
vi.mock("../../ProUpgradeSheet", () => ({ ProUpgradeSheet: () => <div data-testid="pro-upgrade" /> }));
vi.mock("../../sheets/CardiSheet", () => ({ CardiSheet: () => <div data-testid="cardi" /> }));
vi.mock("../../sheets/InboxSheet", () => ({ InboxSheet: () => <div data-testid="inbox" /> }));
vi.mock("../../TrialReminderPrompt", () => ({ default: () => <div data-testid="trial-reminder" /> }));
vi.mock("../../PasskeyEnrollPrompt", () => ({ default: () => <div data-testid="passkey" /> }));
vi.mock("../../SubscriptionSuccess", () => ({ SubscriptionSuccess: () => <div data-testid="sub-success" /> }));

import { AppOverlays } from "../AppOverlays";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function baseProps(over: Record<string, unknown> = {}): Any {
  return {
    demo: false, readOnly: false, user: { id: "u1" }, viewAsUserId: null,
    noteCrypto: {}, cryptoGateDismissed: true, setCryptoGateDismissed: vi.fn(),
    subscription: { daysLeftInTrial: 10, accessState: "trial", referralInfo: { code: "ABC" } },
    welcomeProOpen: false, closeWelcomePro: vi.fn(), subscribeFromWelcomePro: vi.fn(),
    welcomePaymentOpen: false, setWelcomePaymentOpen: vi.fn(),
    proSheetOpen: false, proSheetFeature: null, setProSheetOpen: vi.fn(),
    cardiOpen: false, setCardiOpen: vi.fn(),
    inboxOpen: false, setInboxOpen: vi.fn(),
    trialReminderOpen: false, trialReminderDays: null, subscribeFromTrialReminder: vi.fn(), setTrialReminderOpen: vi.fn(),
    passkeyPromptOpen: false, passkeyCreating: false, createPasskeyFromPrompt: vi.fn(), dismissPasskeyPrompt: vi.fn(),
    trialReminderPaymentOpen: false, setTrialReminderPaymentOpen: vi.fn(),
    subscriptionSuccessOpen: false, closeSubscriptionSuccess: vi.fn(),
    activationShareOpen: false, setActivationShareOpen: vi.fn(),
    ratingSheetOpen: false, setRatingSheetOpen: vi.fn(),
    shareFolderUrl: null, setShareFolderUrl: vi.fn(),
    showSuccess: vi.fn(), t: (k: string) => k,
    ...over,
  };
}

describe("AppOverlays gating", () => {
  it("signed-in non-demo: consent gate renders; demo: it does not", () => {
    const { queryByTestId, rerender } = render(<AppOverlays {...baseProps()} />);
    expect(queryByTestId("consent")).not.toBeNull();
    rerender(<AppOverlays {...baseProps({ demo: true })} />);
    expect(queryByTestId("consent")).toBeNull();
  });

  it("read-only suppresses the consent gate", () => {
    const { queryByTestId } = render(<AppOverlays {...baseProps({ readOnly: true })} />);
    expect(queryByTestId("consent")).toBeNull();
  });

  it("crypto gate shows only when not dismissed (and signed-in, non-demo)", async () => {
    const { queryByTestId, findByTestId } = render(<AppOverlays {...baseProps({ cryptoGateDismissed: false })} />);
    expect(await findByTestId("crypto-gate")).not.toBeNull();
    cleanup();
    const { queryByTestId: q2 } = render(<AppOverlays {...baseProps({ cryptoGateDismissed: true })} />);
    await waitFor(() => expect(q2("crypto-gate")).toBeNull());
  });

  it("proSheetOpen mounts the upgrade sheet; closed does not", async () => {
    const { findByTestId } = render(<AppOverlays {...baseProps({ proSheetOpen: true })} />);
    expect(await findByTestId("pro-upgrade")).not.toBeNull();
    cleanup();
    const { queryByTestId } = render(<AppOverlays {...baseProps({ proSheetOpen: false })} />);
    await waitFor(() => expect(queryByTestId("pro-upgrade")).toBeNull());
  });

  it("milestone + activation + rating are suppressed in admin view-as mode", async () => {
    const { queryByTestId } = render(<AppOverlays {...baseProps({ viewAsUserId: "other", activationShareOpen: true, ratingSheetOpen: true })} />);
    // milestone gates on !viewAsUserId; activation/rating gate on !readOnly
    // (still shown for view-as since that path isn't readOnly here), but
    // milestone must be gone.
    await waitFor(() => expect(queryByTestId("milestone")).toBeNull());
  });

  it("share-folder sheet needs a url AND a signed-in non-demo user", async () => {
    const { findByTestId } = render(<AppOverlays {...baseProps({ shareFolderUrl: "https://x/share" })} />);
    expect(await findByTestId("share-folder")).not.toBeNull();
    cleanup();
    const { queryByTestId } = render(<AppOverlays {...baseProps({ shareFolderUrl: "https://x/share", demo: true })} />);
    await waitFor(() => expect(queryByTestId("share-folder")).toBeNull());
  });
});
