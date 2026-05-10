/* ── POST /api/session-request-respond-token ──────────────────────
   Token-authenticated counterpart to /api/session-request-respond.
   Called by the confirm form rendered at /api/r/[token]. The token
   IS the auth — no JWT required. The token is single-use (cleared
   on apply) so a leaked link can act once and never again.

   Form encoding: the email-link confirm page POSTs as
   application/x-www-form-urlencoded (no JS, just <form>). We accept
   that or JSON.

   Response is HTML (the form submitter is a plain page, not an
   AJAX call) — same self-contained styling as /api/r/[token].

   Side effects identical to /api/session-request-respond: applyAccept
   updates session row + emails patient; applyReject just emails
   patient. Therapist does NOT receive an email confirmation since
   they're the one who just clicked the button. */

import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import {
  findRequestByToken, applyAccept, applyReject, fetchPartiesForRequest,
} from "./_rescheduleRequest.js";
import {
  sendRescheduleAcceptedEmails, sendRescheduleRejectedEmails,
} from "./_sessionEmail.js";

const APP_URL = "https://cardigan.mx";
const MAX_NOTE_LEN = 500;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function htmlPage({ title, body }) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
       color:#2E2E2E;background:#FAF8F4;margin:0;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;max-width:480px;width:100%;
        border:1px solid #E5E1D9;border-radius:16px;
        box-shadow:0 8px 32px rgba(46,46,46,0.06);
        padding:28px 24px;text-align:left}
  .icon{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;
        justify-content:center;margin:0 0 14px;font-size:22px}
  .icon-ok{background:#E8F4EE;color:#2F8F6A}
  .icon-no{background:#FCEAEA;color:#C95B5B}
  .icon-warn{background:#FAF1D9;color:#A37A1F}
  h1{font-size:20px;font-weight:800;margin:0 0 8px;letter-spacing:-0.3px}
  p{font-size:14px;color:#6E6E6E;line-height:1.55;margin:0 0 12px}
  a{color:#3D7E8F;font-weight:600}
  .move{background:#FAF7EE;border-radius:10px;padding:10px 12px;font-size:13px;
        color:#444;margin-top:14px;line-height:1.5}
</style>
</head><body><main class="card">${body}</main></body></html>`;
}

// Vercel Node functions parse JSON bodies automatically; HTML form
// posts arrive as application/x-www-form-urlencoded which the default
// parser sees as a string body (or {} on raw). Handle both.
function readField(req, name) {
  if (req.body && typeof req.body === "object" && req.body[name] != null) {
    return req.body[name];
  }
  if (typeof req.body === "string") {
    const params = new URLSearchParams(req.body);
    return params.get(name);
  }
  return null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = readField(req, "token");
  const action = readField(req, "action");
  const note = readField(req, "note");

  if (typeof token !== "string" || !token) {
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(htmlPage({
      title: "Falta el token",
      body: `<div class="icon icon-warn">!</div>
        <h1>Enlace inválido</h1>
        <p>No encontramos el identificador de esta solicitud. Abre Cardigan para revisar el estado de la cita.</p>
        <p><a href="${APP_URL}">Abrir Cardigan</a></p>`,
    }));
  }
  if (action !== "accept" && action !== "reject") {
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(htmlPage({
      title: "Acción inválida",
      body: `<div class="icon icon-warn">!</div>
        <h1>No pude procesar la respuesta</h1>
        <p>Vuelve al correo y toca el botón otra vez.</p>`,
    }));
  }
  const cleanNote = typeof note === "string" ? note.trim().slice(0, MAX_NOTE_LEN) : "";

  const svc = getServiceClient();
  const { row, action: tokenAction } = await findRequestByToken(svc, token);
  if (!row) {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(htmlPage({
      title: "Enlace inválido o vencido",
      body: `<div class="icon icon-warn">?</div>
        <h1>Esta solicitud ya no está disponible</h1>
        <p>Es posible que ya haya sido resuelta o que el enlace haya vencido.</p>
        <p><a href="${APP_URL}">Abrir Cardigan</a></p>`,
    }));
  }

  // Sanity: the token's "kind" must match the action the form
  // submitted. Stops a malicious or buggy POST from approving via
  // the reject token or vice versa.
  if (action === "accept" && tokenAction !== "approve") {
    return res.status(400).json({ error: "Token mismatch" });
  }
  if (action === "reject" && tokenAction !== "reject") {
    return res.status(400).json({ error: "Token mismatch" });
  }

  if (row.status !== "pending") {
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(htmlPage({
      title: "Solicitud ya resuelta",
      body: `<div class="icon icon-warn">✓</div>
        <h1>Esta solicitud ya fue resuelta</h1>
        <p>Otro paso (otro dispositivo, un email anterior, o el cron de vencimiento) ya cerró esta solicitud. Estado actual: <strong>${escapeHtml(row.status)}</strong>.</p>
        <p><a href="${APP_URL}">Abrir Cardigan</a></p>`,
    }));
  }

  const apply = action === "accept" ? applyAccept : applyReject;
  const out = await apply(svc, row, {
    resolvedBy: "therapist_email",
    therapistNote: cleanNote,
  });
  if (!out.ok) {
    let body;
    if (out.code === "conflict") {
      body = `<div class="icon icon-no">!</div>
        <h1>Ese horario ya está ocupado</h1>
        <p>Mientras llegaba esta solicitud, otra cita ocupó ese horario. Abre Cardigan para mover esta cita a otro espacio o pídele a la persona que proponga un horario distinto.</p>
        <p><a href="${APP_URL}">Abrir Cardigan</a></p>`;
    } else if (out.code === "race_lost") {
      body = `<div class="icon icon-warn">!</div>
        <h1>El estado de la cita cambió</h1>
        <p>Otro proceso (cancelación, edición manual) modificó esta cita antes de que la solicitud se aplicara. Abre Cardigan para ver el estado actual.</p>
        <p><a href="${APP_URL}">Abrir Cardigan</a></p>`;
    } else if (out.code === "not_pending") {
      body = `<div class="icon icon-warn">✓</div>
        <h1>Esta solicitud ya estaba resuelta</h1>
        <p>Estado: <strong>${escapeHtml(out.current_status || "?")}</strong>.</p>
        <p><a href="${APP_URL}">Abrir Cardigan</a></p>`;
    } else {
      body = `<div class="icon icon-no">!</div>
        <h1>Algo salió mal</h1>
        <p>No pudimos guardar la respuesta. Inténtalo desde la app: <a href="${APP_URL}">Abrir Cardigan</a>.</p>`;
    }
    res.status(out.code === "db_error" ? 500 : 409).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(htmlPage({ title: "No se pudo aplicar la respuesta", body }));
  }

  // Best-effort patient email — never blocks the success page.
  try {
    const parties = await fetchPartiesForRequest(svc, row);
    const ctx = {
      ...parties,
      oldDate: row.original_date,
      oldTime: row.original_time,
      newDate: row.proposed_date,
      newTime: row.proposed_time,
      therapistNote: cleanNote || "",
    };
    if (action === "accept") await sendRescheduleAcceptedEmails(ctx);
    else await sendRescheduleRejectedEmails(ctx);
  } catch (err) {
    console.warn("session-request-respond-token: email failed:", err?.message);
  }

  // Success page.
  const successBody = action === "accept"
    ? `<div class="icon icon-ok">✓</div>
       <h1>Cambio aceptado</h1>
       <p>La cita se movió a su nuevo horario y la persona ya recibió la confirmación por correo.</p>
       <div class="move"><strong>Nuevo horario:</strong> ${escapeHtml(row.proposed_date)} · ${escapeHtml(row.proposed_time)}</div>
       <p style="margin-top:18px;"><a href="${APP_URL}">Abrir Cardigan</a></p>`
    : `<div class="icon icon-no">✕</div>
       <h1>Cambio rechazado</h1>
       <p>La cita queda en su horario original. La persona ya recibió el aviso por correo.</p>
       <div class="move"><strong>Horario original:</strong> ${escapeHtml(row.original_date)} · ${escapeHtml(row.original_time)}</div>
       <p style="margin-top:18px;"><a href="${APP_URL}">Abrir Cardigan</a></p>`;

  res.status(200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Cache-Control", "no-store");
  return res.send(htmlPage({ title: action === "accept" ? "Cambio aceptado" : "Cambio rechazado", body: successBody }));
}

// Vercel Node functions default to JSON body parsing. Form posts
// arrive as urlencoded; readField() handles both. No special body
// parser config needed (the default 1 MB limit is fine — payloads
// here are tiny).
export default withSentry(handler, { name: "session-request-respond-token" });
