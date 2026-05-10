/* ── Session lifecycle emails (cancel + reschedule) ──
   When a patient self-cancels or self-reschedules a session, both
   parties get an email confirmation. Mirrors the push-notification
   pattern in patient-cancel-session.js / patient-reschedule-session.js
   — best-effort, never throws, never blocks the DB write. Each
   recipient is fanned out via Promise.allSettled so one bad address
   can't sink the other.

   Returns an array of { ok, error?, id? } in the order [patient,
   therapist] (skipping recipients with no email). Caller can log
   the summary. */

import { sendTransactionalEmail } from "./_email.js";

const APP_URL = "https://cardigan.mx";

function htmlWrap(inner) {
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#2E2E2E;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">${inner}<p style="font-size:12px;color:#888;margin-top:32px;">Cardigan — gestión de consultorio para terapeutas. Si recibiste este correo por error, contesta y lo arreglamos.</p></body></html>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ctaButton(href, label) {
  return `<p style="margin:24px 0;"><a href="${href}" style="background:#5B9BAF;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;">${escapeHtml(label)}</a></p>`;
}

export async function sendCancelNotificationEmails({
  patientEmail,
  patientGreetingName,   // patient.parent if minor, else patient.name
  patientDisplayName,    // patient.name (always — used in therapist copy)
  therapistEmail,
  therapistName,
  date,
  time,
  cancelNote,
}) {
  const tasks = [];

  if (patientEmail) {
    const noteLine = cancelNote
      ? `<p>Motivo: ${escapeHtml(cancelNote)}</p>`
      : "";
    const therapistLine = therapistName
      ? ` con ${escapeHtml(therapistName)}`
      : "";
    const html = htmlWrap(`
      <p>Hola ${escapeHtml(patientGreetingName || patientDisplayName || "")},</p>
      <p>Confirmamos la cancelación de tu sesión${therapistLine} programada para el <strong>${escapeHtml(date)}</strong> a las <strong>${escapeHtml(time)}</strong>.</p>
      ${noteLine}
      <p>Esta cancelación se cobra como sesión completa por defecto. Si tu profesionista decide no cobrarla, te avisará.</p>
      <p>Si necesitas reagendar, puedes hacerlo desde la app.</p>
      ${ctaButton(APP_URL, "Abrir Cardigan")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: patientEmail,
        subject: `Sesión cancelada (con cargo) — ${date} ${time}`,
        html,
      })
    );
  }

  if (therapistEmail) {
    const noteLine = cancelNote
      ? `<p>Motivo indicado: ${escapeHtml(cancelNote)}</p>`
      : "";
    const html = htmlWrap(`
      <p>Hola${therapistName ? ` ${escapeHtml(therapistName)}` : ""},</p>
      <p><strong>${escapeHtml(patientDisplayName || "Un paciente")}</strong> canceló su sesión del <strong>${escapeHtml(date)}</strong> a las <strong>${escapeHtml(time)}</strong>.</p>
      ${noteLine}
      <p>La sesión se marcó automáticamente como <strong>cancelada con cargo</strong> (cuenta para el saldo del paciente). Si decides no cobrarla, abre la sesión en tu agenda y cámbiala a "Cancelada sin cargo".</p>
      ${ctaButton(`${APP_URL}/#agenda`, "Ver agenda")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: therapistEmail,
        subject: `${patientDisplayName || "Un paciente"} canceló su sesión (con cargo)`,
        html,
      })
    );
  }

  const results = await Promise.allSettled(tasks);
  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { ok: false, error: r.reason?.message || "rejected" }
  );
}

// ── Reschedule WITHDRAWN email ────────────────────────────────────
// Sent to the therapist (only — no patient self-loop) when the
// patient retracts their pending request before the therapist had a
// chance to respond. Otherwise the therapist would see the banner
// count drop with no context, leaving them wondering whether they
// missed something. We fire and forget — failure doesn't block
// the withdrawal itself.

export async function sendRescheduleWithdrawnEmails({
  therapistEmail,
  therapistName,
  patientDisplayName,
  oldDate,
  oldTime,
  newDate,
  newTime,
}) {
  if (!therapistEmail) return [];
  const html = htmlWrap(`
    <p>Hola${therapistName ? ` ${escapeHtml(therapistName)}` : ""},</p>
    <p><strong>${escapeHtml(patientDisplayName || "Un paciente")}</strong> retiró su solicitud para mover la cita:</p>
    <p>${escapeHtml(oldDate)} a las ${escapeHtml(oldTime)} → ${escapeHtml(newDate)} a las ${escapeHtml(newTime)}</p>
    <p>La cita queda en su horario original. No hace falta que respondas — la solicitud ya no aparece en tu pantalla principal.</p>
    ${ctaButton(`${APP_URL}/#agenda`, "Ver agenda")}
    <p>— Cardigan</p>
  `);
  const result = await sendTransactionalEmail({
    to: therapistEmail,
    subject: `${patientDisplayName || "Un paciente"} retiró su solicitud`,
    html,
  });
  return [result];
}

// ── Reschedule REQUEST emails ─────────────────────────────────────
// Sent when a patient submits a reschedule request. Therapist gets
// the [Aceptar] / [Rechazar] action buttons that link to the public
// token-based landing page; patient gets a confirmation that the
// request was sent and what to expect next.

export async function sendRescheduleRequestEmails({
  patientEmail,
  patientGreetingName,
  patientDisplayName,
  therapistEmail,
  therapistName,
  oldDate,
  oldTime,
  newDate,
  newTime,
  patientNote,
  approveUrl,
  rejectUrl,
}) {
  const tasks = [];
  const movedLine = `${escapeHtml(oldDate)} a las ${escapeHtml(oldTime)} → <strong>${escapeHtml(newDate)} a las ${escapeHtml(newTime)}</strong>`;

  if (therapistEmail) {
    const noteLine = patientNote
      ? `<p style="background:#FAF7EE;border-radius:10px;padding:10px 12px;margin:14px 0;"><strong>Mensaje:</strong> ${escapeHtml(patientNote)}</p>`
      : "";
    // Two clearly-distinct buttons. Approve = filled teal, Reject =
    // outlined red. Same color logic as the in-app pills.
    const buttons = `
      <p style="margin:24px 0 8px;">
        <a href="${approveUrl}" style="background:#5B9BAF;color:#fff;padding:13px 22px;border-radius:100px;text-decoration:none;font-weight:700;display:inline-block;">Aceptar el cambio</a>
      </p>
      <p style="margin:0 0 24px;">
        <a href="${rejectUrl}" style="background:#fff;color:#C95B5B;border:1px solid #C95B5B;padding:12px 22px;border-radius:100px;text-decoration:none;font-weight:700;display:inline-block;">Rechazar el cambio</a>
      </p>`;
    const html = htmlWrap(`
      <p>Hola${therapistName ? ` ${escapeHtml(therapistName)}` : ""},</p>
      <p><strong>${escapeHtml(patientDisplayName || "Un paciente")}</strong> pidió cambiar el horario de su sesión:</p>
      <p>${movedLine}</p>
      ${noteLine}
      <p>Tú decides — toca el botón que corresponda. Hasta que tu acción quede registrada, la cita sigue en su horario original.</p>
      ${buttons}
      <p style="font-size:12px;color:#888;">¿Prefieres responder desde la app? Abre Cardigan y verás la solicitud en pantalla principal.</p>
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: therapistEmail,
        subject: `${patientDisplayName || "Un paciente"} pidió cambiar su horario`,
        html,
      })
    );
  }

  if (patientEmail) {
    const therapistLine = therapistName ? ` con ${escapeHtml(therapistName)}` : "";
    const html = htmlWrap(`
      <p>Hola ${escapeHtml(patientGreetingName || patientDisplayName || "")},</p>
      <p>Recibimos tu solicitud para mover la cita${therapistLine}:</p>
      <p>${movedLine}</p>
      <p>${escapeHtml(therapistName || "Tu profesionista")} recibió la solicitud y te avisará cuando responda. La cita queda en el horario original hasta entonces.</p>
      ${ctaButton(APP_URL, "Abrir Cardigan")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: patientEmail,
        subject: `Solicitud enviada — ${newDate} ${newTime}`,
        html,
      })
    );
  }

  const results = await Promise.allSettled(tasks);
  return results.map((r) =>
    r.status === "fulfilled" ? r.value : { ok: false, error: r.reason?.message || "rejected" }
  );
}

// ── Reschedule ACCEPTED emails ────────────────────────────────────
// Sent when the therapist accepts (in-app or via email link). Patient
// gets confirmation; therapist doesn't need a self-loop email.

export async function sendRescheduleAcceptedEmails({
  patientEmail,
  patientGreetingName,
  patientDisplayName,
  therapistName,
  oldDate,
  oldTime,
  newDate,
  newTime,
  therapistNote,
}) {
  const tasks = [];
  if (patientEmail) {
    const therapistLine = therapistName ? ` con ${escapeHtml(therapistName)}` : "";
    const noteLine = therapistNote
      ? `<p style="background:#E8F4EE;border-radius:10px;padding:10px 12px;margin:14px 0;"><strong>Mensaje:</strong> ${escapeHtml(therapistNote)}</p>`
      : "";
    const html = htmlWrap(`
      <p>Hola ${escapeHtml(patientGreetingName || patientDisplayName || "")},</p>
      <p>${escapeHtml(therapistName || "Tu profesionista")} aceptó tu solicitud${therapistLine}. La cita está confirmada en el nuevo horario:</p>
      <p>${escapeHtml(oldDate)} a las ${escapeHtml(oldTime)} → <strong>${escapeHtml(newDate)} a las ${escapeHtml(newTime)}</strong></p>
      ${noteLine}
      ${ctaButton(APP_URL, "Ver mi cita")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: patientEmail,
        subject: `Cita confirmada — ${newDate} ${newTime}`,
        html,
      })
    );
  }
  const results = await Promise.allSettled(tasks);
  return results.map((r) => (r.status === "fulfilled" ? r.value : { ok: false, error: r.reason?.message || "rejected" }));
}

// ── Reschedule REJECTED emails ────────────────────────────────────

// `newDate` / `newTime` are accepted but unused — the rejection
// email tells the patient the cita stays at oldDate/oldTime, so
// surfacing the proposed slot would just confuse. Kept in the
// signature so call sites can pass the same context bundle they
// build for accepted/expired without per-variant trimming.
export async function sendRescheduleRejectedEmails({
  patientEmail,
  patientGreetingName,
  patientDisplayName,
  therapistName,
  oldDate,
  oldTime,
  newDate: _newDate,
  newTime: _newTime,
  therapistNote,
}) {
  const tasks = [];
  if (patientEmail) {
    const therapistLine = therapistName ? ` con ${escapeHtml(therapistName)}` : "";
    const noteLine = therapistNote
      ? `<p style="background:#FCEAEA;border-radius:10px;padding:10px 12px;margin:14px 0;"><strong>Mensaje:</strong> ${escapeHtml(therapistNote)}</p>`
      : "";
    const html = htmlWrap(`
      <p>Hola ${escapeHtml(patientGreetingName || patientDisplayName || "")},</p>
      <p>${escapeHtml(therapistName || "Tu profesionista")} no pudo confirmar el cambio que pediste${therapistLine}. La cita queda en su horario original:</p>
      <p><strong>${escapeHtml(oldDate)} a las ${escapeHtml(oldTime)}</strong></p>
      ${noteLine}
      <p>Si quieres proponer otro horario, puedes hacerlo desde la app. Si no es buen momento para reagendar, ${escapeHtml(therapistName || "tu profesionista")} se pondrá en contacto contigo.</p>
      ${ctaButton(APP_URL, "Abrir Cardigan")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: patientEmail,
        subject: `Cambio de horario no confirmado — ${oldDate} ${oldTime} sigue en pie`,
        html,
      })
    );
  }
  const results = await Promise.allSettled(tasks);
  return results.map((r) => (r.status === "fulfilled" ? r.value : { ok: false, error: r.reason?.message || "rejected" }));
}

// ── Reschedule EXPIRED emails ─────────────────────────────────────
// Fired by the cron when a pending request hasn't been answered by
// 1h before the earlier of (original, proposed) start time. Both
// parties are notified — therapist because they may have meant to
// respond and lost track; patient because their session stays at
// the original time and they need to know.

export async function sendRescheduleExpiredEmails({
  patientEmail,
  patientGreetingName,
  patientDisplayName,
  therapistEmail,
  therapistName,
  oldDate,
  oldTime,
  newDate,
  newTime,
}) {
  const tasks = [];
  if (patientEmail) {
    const html = htmlWrap(`
      <p>Hola ${escapeHtml(patientGreetingName || patientDisplayName || "")},</p>
      <p>La solicitud para mover tu cita venció sin respuesta. La cita queda en su horario original:</p>
      <p><strong>${escapeHtml(oldDate)} a las ${escapeHtml(oldTime)}</strong></p>
      <p>Si todavía necesitas otro horario, puedes enviar una nueva solicitud desde la app.</p>
      ${ctaButton(APP_URL, "Abrir Cardigan")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: patientEmail,
        subject: `Solicitud vencida — tu cita sigue el ${oldDate} a las ${oldTime}`,
        html,
      })
    );
  }
  if (therapistEmail) {
    const html = htmlWrap(`
      <p>Hola${therapistName ? ` ${escapeHtml(therapistName)}` : ""},</p>
      <p>Una solicitud de cambio de horario de <strong>${escapeHtml(patientDisplayName || "un paciente")}</strong> venció sin respuesta:</p>
      <p>${escapeHtml(oldDate)} a las ${escapeHtml(oldTime)} → ${escapeHtml(newDate)} a las ${escapeHtml(newTime)}</p>
      <p>La cita queda en su horario original. Si quieres aceptar el cambio aún, abre Cardigan y mueve la cita manualmente.</p>
      ${ctaButton(`${APP_URL}/#agenda`, "Ver agenda")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: therapistEmail,
        subject: `Solicitud vencida — ${patientDisplayName || "un paciente"}`,
        html,
      })
    );
  }
  const results = await Promise.allSettled(tasks);
  return results.map((r) => (r.status === "fulfilled" ? r.value : { ok: false, error: r.reason?.message || "rejected" }));
}
