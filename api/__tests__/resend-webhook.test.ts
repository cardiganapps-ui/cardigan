import { describe, it, expect } from "vitest";
import { resendEventUid } from "../resend-webhook.js";

/* The webhook log is made idempotent by a unique index on event_uid
   (migration 082) + insert/skip-on-23505. Pin the composite key so a
   redelivery of the same delivery event always collapses to one row,
   while distinct events (different type or timestamp on the same email)
   stay separate. */
describe("resendEventUid", () => {
  it("is stable for the same delivery event", () => {
    const a = resendEventUid("e1", "email.delivered", "2026-06-23T10:00:00Z");
    const b = resendEventUid("e1", "email.delivered", "2026-06-23T10:00:00Z");
    expect(a).toBe(b);
  });

  it("differs across event type and timestamp on the same email", () => {
    const delivered = resendEventUid("e1", "email.delivered", "2026-06-23T10:00:00Z");
    const opened = resendEventUid("e1", "email.opened", "2026-06-23T10:00:00Z");
    const laterDelivered = resendEventUid("e1", "email.delivered", "2026-06-23T10:05:00Z");
    expect(delivered).not.toBe(opened);
    expect(delivered).not.toBe(laterDelivered);
  });

  it("coalesces a missing email_id to an empty segment without throwing", () => {
    expect(resendEventUid(null, "email.bounced", "2026-06-23T10:00:00Z")).toBe("|email.bounced|2026-06-23T10:00:00Z");
    expect(resendEventUid(undefined, "x", "t")).toBe("|x|t");
  });
});
