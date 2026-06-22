/* ── GET /api/r/[token] ────────────────────────────────────────────
   Public landing page for the email-link reschedule two-step. The
   therapist clicks "Aceptar" or "Rechazar" in the email, lands here,
   sees the request details + a single confirm button, and only on
   that confirm-click do we apply the change.

   Why two-step: mail clients prefetch links, antivirus scanners
   follow them, the recipient's mail preview can fire a one-click
   GET accidentally. A confirm-click on a rendered page is the
   industry-standard guard (Calendly accept buttons, GitHub PR
   reviews). Cost is one extra tap; benefit is no surprise state
   changes.

   The page POSTs back to /api/session-request-respond-token. Both
   endpoints share the same token lookup helper.

   Token lifecycle:
     - Created by /api/patient-reschedule-session
     - Looked up here (read-only)
     - Spent + nulled on confirm via the POST endpoint
     - Cleared by withdrawal / expiry / acceptance through any path

   Stale link UX: if the request is already resolved (accepted,
   rejected, withdrawn, expired) we render a friendly "Esta solicitud
   ya fue {status}" page instead of a confirm form. */

import { getServiceClient } from "./../_admin.js";
import { withSentry } from "./../_sentry.js";
import { findRequestByToken } from "./../_rescheduleRequest.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const APP_URL = "https://cardigan.mx";

function escapeHtml(s: Row) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function htmlPage({ title, body }: Row) {
  // Self-contained — no JS, no external CSS. Inline styles match
  // the Cardigan brand tokens approximately (tokens themselves live
  // in the SPA bundle which we don't load here).
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
         color: #2E2E2E; background: #FAF8F4; margin: 0;
         min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; max-width: 480px; width: 100%;
          border: 1px solid #E5E1D9; border-radius: 16px;
          box-shadow: 0 8px 32px rgba(46,46,46,0.06);
          padding: 28px 24px; text-align: left; }
  h1 { font-size: 20px; font-weight: 800; margin: 0 0 8px;
       letter-spacing: -0.3px; }
  .sub { font-size: 14px; color: #6E6E6E; margin: 0 0 20px; line-height: 1.5; }
  .move { background: #EAF3F5; border: 1px solid #D2E5EA;
          border-radius: 12px; padding: 14px 16px; margin: 0 0 18px;
          font-size: 14px; line-height: 1.5; }
  .move .row { display: flex; gap: 8px; align-items: baseline; }
  .move .label { font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
                 color: #8E8E8E; text-transform: uppercase; min-width: 84px; }
  .move .val { font-weight: 700; color: #2E2E2E; font-variant-numeric: tabular-nums; }
  .move hr { border: none; border-top: 1px dashed #C8DAE0; margin: 8px 0; }
  .note { font-size: 13px; color: #555; background: #FAF7EE;
          border-radius: 10px; padding: 10px 12px; margin: 0 0 18px; }
  textarea { width: 100%; min-height: 60px; padding: 10px;
             border: 1px solid #DDD; border-radius: 10px;
             font: inherit; font-size: 13px; color: #2E2E2E;
             background: #fff; resize: vertical; box-sizing: border-box;
             margin-bottom: 12px; }
  button { display: block; width: 100%; padding: 13px;
           border: none; border-radius: 100px; cursor: pointer;
           font: inherit; font-size: 15px; font-weight: 700;
           -webkit-appearance: none; }
  .btn-approve { background: #5B9BAF; color: #fff; }
  .btn-reject { background: #fff; color: #C95B5B;
                border: 1px solid #C95B5B; }
  .meta { font-size: 12px; color: #8E8E8E; margin-top: 18px;
          padding-top: 14px; border-top: 1px solid #EFEAE0;
          line-height: 1.5; }
  a { color: #3D7E8F; }
  .empty-icon { width: 48px; height: 48px; border-radius: 50%;
                background: #F4EFE3; display: flex; align-items: center;
                justify-content: center; color: #8E8E8E; margin: 0 0 14px;
                font-size: 22px; }
</style>
</head>
<body>
  <main class="card">${body}</main>
</body>
</html>`;
}

function renderConfirmForm({ token, action, request, patientDisplayName }: Row) {
  const isApprove = action === "approve";
  const title = isApprove ? "¿Aceptar el cambio de horario?" : "¿Rechazar el cambio?";
  const sub = isApprove
    ? `${escapeHtml(patientDisplayName || "Tu paciente")} pidió mover su sesión. Si aceptas, la cita se movera al nuevo horario y avisaremos a la persona.`
    : `${escapeHtml(patientDisplayName || "Tu paciente")} pidió mover su sesión. Si rechazas, la cita queda en el horario original y avisaremos a la persona.`;
  const noteLine = request.patient_note
    ? `<p class="note"><strong>Mensaje de la persona:</strong> ${escapeHtml(request.patient_note)}</p>`
    : "";
  const buttonClass = isApprove ? "btn-approve" : "btn-reject";
  const buttonLabel = isApprove ? "Aceptar el cambio" : "Rechazar el cambio";
  return htmlPage({
    title,
    body: `
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">${sub}</p>
      <div class="move">
        <div class="row">
          <span class="label">Original</span>
          <span class="val">${escapeHtml(request.original_date)} · ${escapeHtml(request.original_time)}</span>
        </div>
        <hr/>
        <div class="row">
          <span class="label">Nuevo</span>
          <span class="val">${escapeHtml(request.proposed_date)} · ${escapeHtml(request.proposed_time)}</span>
        </div>
      </div>
      ${noteLine}
      <form method="POST" action="/api/session-request-respond-token">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <input type="hidden" name="action" value="${isApprove ? "accept" : "reject"}">
        <textarea name="note" placeholder="Mensaje opcional para la persona…" maxlength="500"></textarea>
        <button type="submit" class="${buttonClass}">${buttonLabel}</button>
      </form>
      <p class="meta">Si abriste este enlace por error, simplemente cierra esta pestaña — no se hace ningún cambio hasta que toques el botón. <a href="${APP_URL}">Abrir Cardigan</a></p>
    `,
  });
}

function renderResolved({ status }: Row) {
  const label = (({
    accepted:  "aceptada",
    rejected:  "rechazada",
    withdrawn: "retirada por la persona",
    expired:   "vencida",
  }) as Row)[status] || status;
  return htmlPage({
    title: "Solicitud ya resuelta",
    body: `
      <div class="empty-icon">✓</div>
      <h1>Esta solicitud ya fue ${escapeHtml(label)}</h1>
      <p class="sub">No hay nada más que hacer aquí. Si quieres ver el estado actual de la cita, abre Cardigan.</p>
      <p><a href="${APP_URL}">Abrir Cardigan</a></p>
    `,
  });
}

function renderNotFound() {
  return htmlPage({
    title: "Enlace inválido",
    body: `
      <div class="empty-icon">?</div>
      <h1>Enlace inválido o vencido</h1>
      <p class="sub">No encontramos esta solicitud. Es posible que ya haya sido resuelta, vencida, o que el enlace esté incompleto. Abre Cardigan para ver el estado de tus citas.</p>
      <p><a href="${APP_URL}">Abrir Cardigan</a></p>
    `,
  });
}

async function handler(req: Row, res: Row) {
  const token = req.query?.token;
  if (typeof token !== "string" || !token || token.length < 16) {
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(renderNotFound());
  }

  const svc = getServiceClient();
  const { row, action } = await findRequestByToken(svc, token);

  // Token didn't match anything → either invalid or already cleared
  // (request was resolved through another path, tokens nulled).
  if (!row || !action) {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(renderNotFound());
  }

  // Pull the patient display name for the confirm copy.
  const { data: patientRow } = await svc
    .from("patients")
    .select("name")
    .eq("id", row.patient_id)
    .maybeSingle();

  if (row.status !== "pending") {
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(renderResolved({ status: row.status }));
  }

  res.status(200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Cache-Control", "no-store");
  return res.send(renderConfirmForm({
    token,
    action,
    request: row,
    patientDisplayName: patientRow?.name || "",
  }));
}

export default withSentry(handler, { name: "r-token" });
