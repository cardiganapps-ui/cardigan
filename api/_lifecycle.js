/* ── Lifecycle email orchestration ────────────────────────────────────
   Wraps the transactional emails Cardigan sends outside of session
   reminders + auth flows:

     trial_day_3            — onboarding nudge ~3 days after sign-up
     trial_day_25           — "5 days left in your trial" reminder
     trial_winback_day_37   — winback ~7 days post-trial-expiry
     payment_failed         — fired from stripe-webhook on
                              invoice.payment_failed
     pro_welcome            — fired the first time a user's Stripe sub
                              transitions to a "real Pro" state (active,
                              past_due, or trialing-with-dpm). Once per
                              user — resubscribers don't get a second
                              welcome.
     pro_cancelled          — fired when a Pro user schedules cancellation
                              (either cancel_at_period_end=true OR
                              cancel_at=<future-ts>). Cleared from
                              lifecycle_emails on reactivation so a
                              future cancellation re-fires.

   Each call is dedupe-write into `lifecycle_emails(user_id, kind)`
   FIRST — a unique-violation means we already sent this kind to this
   user, so we skip the actual Resend call. The "claim the slot
   before sending" order is deliberate: a webhook re-delivery or two
   concurrent cron ticks can't double-send because the second one
   trips the unique constraint and exits.

   All copy lives in this file (Spanish, matches the rest of the
   product). HTML is intentionally minimal — Cardigan's brand voice
   is plain prose with one CTA, not a marketing template. */

import { sendTransactionalEmail } from "./_email.js";

const APP_URL = "https://cardigan.mx";

/* Compose the {subject, html, text} for a given kind. The user
   object is the auth.users row + a few derived fields the caller
   passes in (firstName, daysLeft, lastInvoiceUrl). */
function compose(kind, ctx) {
  const firstName = ctx.firstName || "Hola";

  switch (kind) {
    case "trial_day_3":
      return {
        subject: "¿Cómo va tu primera semana con Cardigan?",
        html: htmlWrap(`
          <p>Hola ${escapeHtml(firstName)},</p>
          <p>Vemos que ya empezaste a probar Cardigan — qué bueno tenerte.</p>
          <p>Si todavía no has agregado a tu primer paciente o registrado tu primera sesión, te dejamos el atajo:</p>
          <p style="margin:24px 0;"><a href="${APP_URL}" style="background:#2E2E2E;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;">Abrir Cardigan</a></p>
          <p>Si tienes cualquier duda, contesta este correo y te respondo personalmente.</p>
          <p>— El equipo de Cardigan</p>
        `),
      };

    case "trial_day_25":
      return {
        subject: "Te quedan 5 días de prueba",
        html: htmlWrap(`
          <p>Hola ${escapeHtml(firstName)},</p>
          <p>Tu prueba de Cardigan termina en 5 días. Si quieres seguir usándolo sin interrupción, puedes suscribirte ahora — no se te cobrará hasta que termine la prueba.</p>
          <p style="margin:24px 0;"><a href="${APP_URL}" style="background:#5B9BAF;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;">Activar Cardigan Pro</a></p>
          <p>Cardigan Pro: $299 MXN al mes, o $2,990 MXN al año (ahorras 17%). Cancela cuando quieras.</p>
          <p>— El equipo de Cardigan</p>
        `),
      };

    case "trial_winback_day_37":
      return {
        subject: "¿Volvemos? Tu cuenta sigue intacta",
        html: htmlWrap(`
          <p>Hola ${escapeHtml(firstName)},</p>
          <p>Tu prueba de Cardigan terminó hace una semana. Tus pacientes, sesiones y notas siguen aquí, esperándote.</p>
          <p>Si te gustaría retomarlo, suscríbete y recuperas todo al instante:</p>
          <p style="margin:24px 0;"><a href="${APP_URL}" style="background:#5B9BAF;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;">Reactivar mi cuenta</a></p>
          <p>Si Cardigan no resultó ser para ti, contesta este correo y nos cuentas qué te gustaría que mejoráramos. Lo leemos todo.</p>
          <p>— El equipo de Cardigan</p>
        `),
      };

    case "payment_failed":
      return {
        subject: "Tu último cobro de Cardigan no se procesó",
        html: htmlWrap(`
          <p>Hola ${escapeHtml(firstName)},</p>
          <p>Intentamos cobrar la renovación de tu suscripción a Cardigan Pro y la tarjeta no procesó el pago. No te preocupes — Stripe lo reintentará automáticamente en los próximos días, y mantienes tu acceso mientras tanto.</p>
          <p>Para no perder Cardigan Pro, te recomendamos actualizar tu método de pago:</p>
          <p style="margin:24px 0;"><a href="${ctx.invoiceUrl || APP_URL}" style="background:#E8B86C;color:#2E2E2E;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;">Revisar pago</a></p>
          <p>— El equipo de Cardigan</p>
        `),
      };

    case "pro_welcome":
      return {
        subject: "Bienvenido a Cardigan Pro",
        html: htmlWrap(`
          <p>Hola ${escapeHtml(firstName)},</p>
          <p>Confirmamos tu suscripción a Cardigan Pro. Gracias por confiarnos tu consultorio — te tomamos en serio.</p>
          <p>Ya tienes acceso completo a todas las funciones: documentos cifrados, sincronización de calendario, recordatorios automáticos, y todo lo que vayamos lanzando.</p>
          <p style="margin:24px 0;"><a href="${APP_URL}" style="background:#5B9BAF;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;">Abrir Cardigan</a></p>
          <p>Puedes administrar tu suscripción, cambiar tu método de pago o descargar tus recibos en cualquier momento desde Ajustes → Suscripción.</p>
          <p>Si en algún momento tienes dudas o sugerencias, contesta este correo — leemos todo.</p>
          <p>— El equipo de Cardigan</p>
        `),
      };

    case "pro_cancelled":
      return {
        subject: "Tu suscripción a Cardigan Pro está programada para cancelarse",
        html: htmlWrap(`
          <p>Hola ${escapeHtml(firstName)},</p>
          <p>Recibimos tu solicitud de cancelación. Conservas acceso completo a Cardigan Pro hasta el ${escapeHtml(ctx.endDateStr || "final del periodo")}; ese día tu cuenta vuelve al modo de prueba.</p>
          <p>Tus pacientes, sesiones y notas se quedan intactos. Si decides regresar — sea en una semana o en un año — todo sigue exactamente como lo dejaste.</p>
          <p style="margin:24px 0;"><a href="${APP_URL}" style="background:#5B9BAF;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;">Reactivar suscripción</a></p>
          <p>Si cancelaste por algo que podemos mejorar, contesta este correo — nos importa entender qué te llevó a la decisión.</p>
          <p>— El equipo de Cardigan</p>
        `),
      };

    default:
      return null;
  }
}

function htmlWrap(inner) {
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#2E2E2E;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">${inner}<p style="font-size:12px;color:#888;margin-top:32px;">Recibes este correo porque tienes una cuenta en Cardigan. Si ya no quieres recibir avisos como este, contesta este correo y lo desactivamos.</p></body></html>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Fire one of the lifecycle emails. Idempotent — claims the
   (user_id, kind) slot in lifecycle_emails before sending. Returns
   { ok: true, sent: false, reason: "duplicate" } when the slot was
   already claimed by a previous run. */
export async function sendLifecycleEmail(svc, { userId, email, firstName, kind, invoiceUrl, endDateStr }) {
  if (!userId || !email || !kind) {
    return { ok: false, error: "missing userId/email/kind" };
  }
  const composed = compose(kind, { firstName, invoiceUrl, endDateStr });
  if (!composed) return { ok: false, error: `unknown kind: ${kind}` };

  // Claim the slot first. A unique-violation (23505) means we've
  // already sent this kind to this user — return early without
  // calling Resend. Any other error bubbles up so the caller can
  // log it; we'd rather skip a send than risk a double-send.
  const { error: claimError } = await svc
    .from("lifecycle_emails")
    .insert({ user_id: userId, kind });
  if (claimError) {
    if (claimError.code === "23505") {
      return { ok: true, sent: false, reason: "duplicate" };
    }
    return { ok: false, error: claimError.message };
  }

  const result = await sendTransactionalEmail({
    to: email,
    subject: composed.subject,
    html: composed.html,
  });
  if (!result.ok) {
    // Roll back the claim so we'll retry next tick. A genuinely-bad
    // address will fail forever, which is fine: the cron quietly
    // burns one cycle per day on it.
    await svc.from("lifecycle_emails")
      .delete()
      .eq("user_id", userId)
      .eq("kind", kind);
    return { ok: false, error: result.error };
  }

  // Stamp the Resend id so we can chase a specific send if the user
  // reports never receiving it.
  if (result.id) {
    await svc.from("lifecycle_emails")
      .update({ resend_id: result.id })
      .eq("user_id", userId)
      .eq("kind", kind);
  }
  return { ok: true, sent: true, id: result.id || null };
}
