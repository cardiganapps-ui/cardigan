/**
 * @vitest-environment happy-dom
 *
 * Characterization tests for the five lifecycle / engagement prompts
 * extracted from App.tsx's AppShell. These pin the side-effect
 * orchestration (localStorage dedup + setTimeout deferral + the gating
 * guards) that the pure decision helpers in utils/modalGates +
 * utils/ratingPrompt can't cover on their own. The pure cadence rules
 * stay covered by utils/__tests__/modalGates.test.ts; this file locks in
 * that the effects wire those decisions to the right state + storage.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// Disable the passkey nudge path so its effect early-returns — no async
// hardware / credential-list checks, no supabase calls. The passkey
// cadence itself is unit-tested in utils/__tests__/modalGates.test.ts.
vi.mock("../../config/passkeys", () => ({
  passkeysAvailable: () => false,
  passkeyPlatformAuthenticatorAvailable: async () => false,
}));
// Stub the supabase client so the test doesn't load the real
// @supabase/supabase-js graph (keeps the module graph light + hermetic).
vi.mock("../../supabaseClient", () => ({
  supabase: {
    auth: {
      passkey: { list: async () => ({ data: [], error: null }) },
      registerPasskey: async () => ({ error: null }),
    },
  },
}));

import { useEngagementPrompts } from "../useEngagementPrompts";

const t = (k: string) => k;
const noop = () => {};

function baseDeps(over: Record<string, unknown> = {}) {
  return {
    demo: false,
    viewAsUserId: null,
    user: { id: "u1", created_at: new Date().toISOString() },
    readOnly: false,
    subscription: { accessState: "trial", daysLeftInTrial: 7, subscribedActive: false, compGranted: false },
    tutorialState: "done",
    upcomingSessions: [],
    patients: [],
    showSuccess: noop,
    showToast: noop,
    t,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe("useEngagementPrompts", () => {
  it("opens the welcome-to-Pro modal after the 600ms hand-off grace (tutorial done)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEngagementPrompts(baseDeps()));
    expect(result.current.welcomeProOpen).toBe(false);
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.welcomeProOpen).toBe(true);
  });

  it("does NOT re-show welcome-to-Pro once the localStorage flag is set", () => {
    vi.useFakeTimers();
    localStorage.setItem("cardigan.welcomePro.shown.v1.u1", "1");
    const { result } = renderHook(() => useEngagementPrompts(baseDeps()));
    act(() => { vi.advanceTimersByTime(11000); });
    expect(result.current.welcomeProOpen).toBe(false);
  });

  it("closeWelcomePro stamps the dedup flag and closes the modal", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEngagementPrompts(baseDeps()));
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.welcomeProOpen).toBe(true);
    act(() => { result.current.closeWelcomePro(); });
    expect(result.current.welcomeProOpen).toBe(false);
    expect(localStorage.getItem("cardigan.welcomePro.shown.v1.u1")).toBe("1");
  });

  it("subscribeFromWelcomePro closes the modal and opens the payment sheet", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEngagementPrompts(baseDeps()));
    act(() => { vi.advanceTimersByTime(600); });
    act(() => { result.current.subscribeFromWelcomePro(); });
    expect(result.current.welcomeProOpen).toBe(false);
    expect(result.current.welcomePaymentOpen).toBe(true);
    expect(localStorage.getItem("cardigan.welcomePro.shown.v1.u1")).toBe("1");
  });

  it("opens the trial reminder after 1200ms at an eligible day count and stamps the day key", () => {
    vi.useFakeTimers();
    // Suppress the welcome-pro path so only the trial reminder is in play.
    localStorage.setItem("cardigan.welcomePro.shown.v1.u1", "1");
    const { result } = renderHook(() => useEngagementPrompts(baseDeps({ subscription: { accessState: "trial", daysLeftInTrial: 7 } })));
    expect(result.current.trialReminderOpen).toBe(false);
    act(() => { vi.advanceTimersByTime(1200); });
    expect(result.current.trialReminderOpen).toBe(true);
    expect(result.current.trialReminderDays).toBe(7);
    expect(localStorage.getItem("cardigan.trialReminder.lastShown.u1")).toBeTruthy();
  });

  it("does NOT re-open the trial reminder when already shown today", () => {
    vi.useFakeTimers();
    localStorage.setItem("cardigan.welcomePro.shown.v1.u1", "1");
    // Stamp today's key so the once-per-day gate blocks it.
    const todayKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
    localStorage.setItem("cardigan.trialReminder.lastShown.u1", todayKey);
    const { result } = renderHook(() => useEngagementPrompts(baseDeps({ subscription: { accessState: "trial", daysLeftInTrial: 7 } })));
    act(() => { vi.advanceTimersByTime(1200); });
    expect(result.current.trialReminderOpen).toBe(false);
  });

  it("does NOT open the trial reminder at a non-threshold day count", () => {
    vi.useFakeTimers();
    localStorage.setItem("cardigan.welcomePro.shown.v1.u1", "1");
    const { result } = renderHook(() => useEngagementPrompts(baseDeps({ subscription: { accessState: "trial", daysLeftInTrial: 9 } })));
    act(() => { vi.advanceTimersByTime(1200); });
    expect(result.current.trialReminderOpen).toBe(false);
  });

  it("fires the subscription-success celebration on the first non-active → active transition", () => {
    const { result } = renderHook(() => useEngagementPrompts(baseDeps({
      subscription: { accessState: "active", daysLeftInTrial: null, subscribedActive: true, compGranted: false },
    })));
    expect(result.current.subscriptionSuccessOpen).toBe(true);
    act(() => { result.current.closeSubscriptionSuccess(); });
    expect(result.current.subscriptionSuccessOpen).toBe(false);
    expect(localStorage.getItem("cardigan.welcomedPro.u1")).toBe("1");
  });

  it("does NOT fire subscription-success when already welcomed (localStorage)", () => {
    localStorage.setItem("cardigan.welcomedPro.u1", "1");
    const { result } = renderHook(() => useEngagementPrompts(baseDeps({
      subscription: { accessState: "active", daysLeftInTrial: null, subscribedActive: true, compGranted: false },
    })));
    expect(result.current.subscriptionSuccessOpen).toBe(false);
  });

  it("fires no prompts in demo mode", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEngagementPrompts(baseDeps({
      demo: true,
      subscription: { accessState: "active", daysLeftInTrial: 7, subscribedActive: true, compGranted: false },
    })));
    act(() => { vi.advanceTimersByTime(12000); });
    expect(result.current.welcomeProOpen).toBe(false);
    expect(result.current.trialReminderOpen).toBe(false);
    expect(result.current.subscriptionSuccessOpen).toBe(false);
    expect(result.current.passkeyPromptOpen).toBe(false);
  });

  it("subscribeFromTrialReminder closes the reminder and opens its payment sheet", () => {
    const { result } = renderHook(() => useEngagementPrompts(baseDeps()));
    act(() => { result.current.subscribeFromTrialReminder(); });
    expect(result.current.trialReminderOpen).toBe(false);
    expect(result.current.trialReminderPaymentOpen).toBe(true);
  });
});
