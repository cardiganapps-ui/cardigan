/* ── Resend transactional email helper ──
   Used by app-level notifications that don't go through Supabase Auth
   (those go via Supabase's SMTP integration). Currently:
     - export-user-data success notice (audit trail; the user gets
       emailed every time someone successfully exports their data
       via /api/export-user-data, even if it's themselves).

   Resend sends from `Cardigan <no-reply@cardigan.mx>`. RESEND_API_KEY
   must be set in the Vercel env (already present, used by Supabase
   SMTP relay too).

   Returns { ok: boolean, error?: string }. Never throws — calling
   sites are best-effort by design (a failed audit email shouldn't
   block the user's actual operation). */

const FROM = "Cardigan <no-reply@cardigan.mx>";

export async function sendTransactionalEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!to || !subject) return { ok: false, error: "missing to / subject" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject,
        html: html || `<p>${text || ""}</p>`,
        text: text || (html ? html.replace(/<[^>]+>/g, "") : ""),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "fetch failed" };
  }
}
