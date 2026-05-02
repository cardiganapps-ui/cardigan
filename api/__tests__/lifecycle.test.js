import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock _email so we don't try to hit Resend in tests.
vi.mock("../_email.js", () => ({
  sendTransactionalEmail: vi.fn(),
}));

import { sendLifecycleEmail } from "../_lifecycle.js";
import { sendTransactionalEmail } from "../_email.js";

/* Build a stub Supabase client that records inserts/deletes/updates
   in-memory so we can assert the dedupe-then-send order. The real
   supabase-js client is rich; we only need a tiny subset here. */
function makeStub({ insertResult = { error: null } } = {}) {
  const calls = { insert: [], update: [], delete: [] };
  let lastFilters = null;
  return {
    calls,
    from: () => ({
      insert: (row) => {
        calls.insert.push(row);
        return { error: insertResult.error };
      },
      update: (row) => {
        lastFilters = { kind: "update", row };
        return {
          eq: () => ({
            eq: () => {
              calls.update.push({ ...lastFilters, ...{ filters: ["eq", "eq"] } });
              return { error: null };
            },
          }),
        };
      },
      delete: () => {
        return {
          eq: () => ({
            eq: () => {
              calls.delete.push("delete");
              return { error: null };
            },
          }),
        };
      },
    }),
  };
}

describe("sendLifecycleEmail", () => {
  beforeEach(() => {
    sendTransactionalEmail.mockReset();
  });

  it("rejects missing required fields", async () => {
    const svc = makeStub();
    const r = await sendLifecycleEmail(svc, {});
    expect(r.ok).toBe(false);
    expect(svc.calls.insert).toHaveLength(0);
  });

  it("rejects unknown kind", async () => {
    const svc = makeStub();
    const r = await sendLifecycleEmail(svc, {
      userId: "u1", email: "a@b.c", kind: "made_up_kind",
    });
    expect(r.ok).toBe(false);
  });

  it("claims the dedupe slot before calling Resend", async () => {
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "re_1" });
    const svc = makeStub();
    await sendLifecycleEmail(svc, {
      userId: "u1", email: "a@b.c", firstName: "Ana", kind: "trial_day_3",
    });
    expect(svc.calls.insert).toHaveLength(1);
    expect(svc.calls.insert[0]).toMatchObject({ user_id: "u1", kind: "trial_day_3" });
    expect(sendTransactionalEmail).toHaveBeenCalledOnce();
  });

  it("treats unique-violation (23505) on the dedupe insert as a no-op", async () => {
    const svc = makeStub({ insertResult: { error: { code: "23505", message: "dup" } } });
    const r = await sendLifecycleEmail(svc, {
      userId: "u1", email: "a@b.c", firstName: "Ana", kind: "trial_day_3",
    });
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("duplicate");
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("rolls the dedupe row back when Resend fails", async () => {
    sendTransactionalEmail.mockResolvedValue({ ok: false, error: "Resend down" });
    const svc = makeStub();
    const r = await sendLifecycleEmail(svc, {
      userId: "u1", email: "a@b.c", firstName: "Ana", kind: "trial_day_3",
    });
    expect(r.ok).toBe(false);
    expect(svc.calls.delete).toHaveLength(1);
  });

  it("escapes HTML in the firstName so a malicious display name can't inject", async () => {
    let captured;
    sendTransactionalEmail.mockImplementation(async (args) => {
      captured = args;
      return { ok: true, id: "re_2" };
    });
    const svc = makeStub();
    await sendLifecycleEmail(svc, {
      userId: "u1", email: "a@b.c", firstName: "<script>x</script>", kind: "trial_day_3",
    });
    expect(captured.html).not.toContain("<script>x</script>");
    expect(captured.html).toContain("&lt;script&gt;");
  });

  it("composes a payment_failed email with the invoice URL", async () => {
    let captured;
    sendTransactionalEmail.mockImplementation(async (args) => {
      captured = args;
      return { ok: true, id: "re_3" };
    });
    const svc = makeStub();
    await sendLifecycleEmail(svc, {
      userId: "u1", email: "a@b.c", firstName: "Ana", kind: "payment_failed",
      invoiceUrl: "https://invoice.example/in_xxx",
    });
    expect(captured.subject).toContain("cobro");
    expect(captured.html).toContain("https://invoice.example/in_xxx");
  });

  it("composes a pro_welcome email", async () => {
    let captured;
    sendTransactionalEmail.mockImplementation(async (args) => {
      captured = args;
      return { ok: true, id: "re_w" };
    });
    const svc = makeStub();
    await sendLifecycleEmail(svc, {
      userId: "u1", email: "a@b.c", firstName: "Ana", kind: "pro_welcome",
    });
    expect(captured.subject).toContain("Bienvenido");
    expect(captured.subject).toContain("Cardigan Pro");
    expect(captured.html).toContain("Confirmamos tu suscripción");
    expect(captured.html).toContain("Ana");
  });

  it("composes a pro_cancelled email with the end date", async () => {
    let captured;
    sendTransactionalEmail.mockImplementation(async (args) => {
      captured = args;
      return { ok: true, id: "re_c" };
    });
    const svc = makeStub();
    await sendLifecycleEmail(svc, {
      userId: "u1", email: "a@b.c", firstName: "Ana", kind: "pro_cancelled",
      endDateStr: "30 de mayo de 2026",
    });
    expect(captured.subject).toContain("cancelarse");
    expect(captured.html).toContain("30 de mayo de 2026");
    // Reactivation CTA
    expect(captured.html).toContain("Reactivar");
  });

  it("pro_cancelled falls back to a generic phrase when no end date provided", async () => {
    let captured;
    sendTransactionalEmail.mockImplementation(async (args) => {
      captured = args;
      return { ok: true, id: "re_c2" };
    });
    const svc = makeStub();
    await sendLifecycleEmail(svc, {
      userId: "u1", email: "a@b.c", firstName: "Ana", kind: "pro_cancelled",
    });
    expect(captured.html).toContain("final del periodo");
  });
});
