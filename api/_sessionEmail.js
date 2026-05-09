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
      <p>Si necesitas reagendar, puedes hacerlo desde la app.</p>
      ${ctaButton(APP_URL, "Abrir Cardigan")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: patientEmail,
        subject: `Sesión cancelada — ${date} ${time}`,
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
      ${ctaButton(`${APP_URL}/#agenda`, "Ver agenda")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: therapistEmail,
        subject: `${patientDisplayName || "Un paciente"} canceló su sesión`,
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

export async function sendRescheduleNotificationEmails({
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
  const movedLine = `${escapeHtml(oldDate)} a las ${escapeHtml(oldTime)} → <strong>${escapeHtml(newDate)} a las ${escapeHtml(newTime)}</strong>`;

  if (patientEmail) {
    const therapistLine = therapistName
      ? ` con ${escapeHtml(therapistName)}`
      : "";
    const html = htmlWrap(`
      <p>Hola ${escapeHtml(patientGreetingName || patientDisplayName || "")},</p>
      <p>Confirmamos el cambio de horario de tu sesión${therapistLine}:</p>
      <p>${movedLine}</p>
      ${ctaButton(APP_URL, "Abrir Cardigan")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: patientEmail,
        subject: `Sesión reagendada — ${newDate} ${newTime}`,
        html,
      })
    );
  }

  if (therapistEmail) {
    const html = htmlWrap(`
      <p>Hola${therapistName ? ` ${escapeHtml(therapistName)}` : ""},</p>
      <p><strong>${escapeHtml(patientDisplayName || "Un paciente")}</strong> reagendó su sesión:</p>
      <p>${movedLine}</p>
      ${ctaButton(`${APP_URL}/#agenda`, "Ver agenda")}
      <p>— Cardigan</p>
    `);
    tasks.push(
      sendTransactionalEmail({
        to: therapistEmail,
        subject: `${patientDisplayName || "Un paciente"} reagendó su sesión`,
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
