/**
 * @vitest-environment happy-dom
 *
 * Locks in the Toast component's screen-reader semantics. Errors and
 * warnings need role=alert + aria-live=assertive so AT users hear
 * them right away; success / info / generic toasts get role=status +
 * aria-live=polite so they queue politely.
 */
import { describe, it, expect } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { Toast } from "../Toast";

// I18n is consumed via useT — set up the minimal provider the
// Toast needs (close label).
import { I18nProvider } from "../../i18n/index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

async function renderToast(props: Row) {
  let res!: ReturnType<typeof render>;
  await act(async () => {
    res = render(
      <I18nProvider>
        <Toast onDismiss={() => {}} persistent {...(props as Row)} />
      </I18nProvider>,
    );
  });
  // Toast starts with visible=false and flips on a mount effect; wait
  // for the live region to actually appear before querying it.
  await waitFor(() => {
    if (!res.container.querySelector("[aria-live]")) throw new Error("not yet");
  });
  return res;
}

// We pin `persistent: true` in renderToast so the dismiss-after-N-ms
// timer doesn't unmount the toast mid-assertion. The auto-dismiss
// path is covered by Toast's existing integration in App.jsx — these
// tests focus on the aria contract.

describe("Toast accessibility", () => {
  it("error → role=alert + aria-live=assertive (interrupts the screen reader)", async () => {
    const { container } = await renderToast({ message: "boom", type: "error" });
    const root = container.querySelector("[aria-live]")!;
    expect(root.getAttribute("role")).toBe("alert");
    expect(root.getAttribute("aria-live")).toBe("assertive");
  });

  it("warning → role=alert + aria-live=assertive", async () => {
    const { container } = await renderToast({ message: "watch out", type: "warning" });
    const root = container.querySelector("[aria-live]")!;
    expect(root.getAttribute("role")).toBe("alert");
    expect(root.getAttribute("aria-live")).toBe("assertive");
  });

  it("success → role=status + aria-live=polite (queues politely)", async () => {
    const { container } = await renderToast({ message: "done", type: "success" });
    const root = container.querySelector("[aria-live]")!;
    expect(root.getAttribute("role")).toBe("status");
    expect(root.getAttribute("aria-live")).toBe("polite");
  });

  it("info → role=status + aria-live=polite", async () => {
    const { container } = await renderToast({ message: "fyi", type: "info" });
    const root = container.querySelector("[aria-live]")!;
    expect(root.getAttribute("role")).toBe("status");
    expect(root.getAttribute("aria-live")).toBe("polite");
  });

  it("aria-atomic=true so partial-update toasts re-announce the full message", async () => {
    const { container } = await renderToast({ message: "x", type: "info" });
    const root = container.querySelector("[aria-live]")!;
    expect(root.getAttribute("aria-atomic")).toBe("true");
  });
});
