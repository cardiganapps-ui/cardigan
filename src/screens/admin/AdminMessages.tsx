import { useState } from "react";
import { AdminPage } from "./parts/AdminPage";
import { adminNotify } from "../../hooks/useCardiganData";
import { IconBell } from "../../components/Icons";

/* ── AdminMessages ──────────────────────────────────────────────────────
   Compose UI for the in-app notification inbox (migration 077). Sends a
   'system' notification to a single user (by id) or broadcasts to every
   user, via POST /api/admin-notify (admin-only, service role). Broadcast
   requires a confirm tap since it writes a row for every account. */
export function AdminMessages() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/");
  const [mode, setMode] = useState("broadcast"); // 'broadcast' | 'user'
  const [userId, setUserId] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; inserted?: number; error?: string } | null>(null); // { ok, inserted } | { error }
  const [confirm, setConfirm] = useState(false);

  const clearConfirm = () => setConfirm(false);
  const canSend =
    title.trim().length > 0 &&
    (mode === "broadcast" || userId.trim().length > 0) &&
    !sending;

  const doSend = async () => {
    setSending(true);
    setResult(null);
    try {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || "/",
        ...(mode === "broadcast" ? { broadcast: true } : { userId: userId.trim() }),
      };
      const r = await adminNotify(payload);
      setResult({ ok: true, inserted: r.inserted });
      setTitle(""); setBody(""); setUrl("/"); setUserId("");
      setConfirm(false);
    } catch (e) {
      setResult({ error: (e as Error).message || "Error" });
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    // Broadcast hits every account — require a deliberate second tap.
    if (mode === "broadcast" && !confirm) { setConfirm(true); return; }
    doSend();
  };

  return (
    <AdminPage title="Mensajes" subtitle="Envía un aviso al inbox de notificaciones de los usuarios.">
      <AdminPage.Section title="Redactar" padded>
        <form onSubmit={onSubmit} style={{ maxWidth: 560 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button type="button" className={`btn ${mode === "broadcast" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setMode("broadcast"); clearConfirm(); }} style={{ flex: 1 }}>Todos</button>
            <button type="button" className={`btn ${mode === "user" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setMode("user"); clearConfirm(); }} style={{ flex: 1 }}>Un usuario</button>
          </div>

          {mode === "user" && (
            <div className="input-group">
              <label className="input-label">User ID</label>
              <input className="input" value={userId} onChange={(e) => { setUserId(e.target.value); clearConfirm(); }} placeholder="uuid del usuario" />
              <div className="input-help">Cópialo desde Usuarios → detalle del usuario.</div>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Título</label>
            <input className="input" value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); clearConfirm(); }} placeholder="Título del aviso" />
          </div>

          <div className="input-group">
            <label className="input-label">Mensaje</label>
            <textarea className="input" rows={4} value={body} maxLength={1000} onChange={(e) => { setBody(e.target.value); clearConfirm(); }} placeholder="Cuerpo (opcional)" style={{ resize: "vertical" }} />
          </div>

          <div className="input-group">
            <label className="input-label">URL al tocar</label>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/" />
            <div className="input-help">A dónde lleva al tocar la notificación (ej. /#agenda).</div>
          </div>

          {/* Live preview of the inbox row */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 12, border: "1px solid var(--border-lt)", borderRadius: "var(--radius)", marginBottom: 14, background: "var(--white)" }}>
            <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--teal-pale)", color: "var(--teal-dark)" }}>
              <IconBell size={16} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--charcoal)" }}>{title.trim() || "Título del aviso"}</div>
              {body.trim() && <div style={{ fontSize: 13, color: "var(--charcoal-md)", marginTop: 2, lineHeight: 1.4 }}>{body.trim()}</div>}
            </div>
          </div>

          <button type="submit" className={`btn ${confirm ? "btn-danger" : "btn-primary"}`} disabled={!canSend} style={{ width: "100%" }}>
            {sending ? "Enviando…" : confirm ? "Confirmar envío a TODOS los usuarios" : (mode === "broadcast" ? "Enviar a todos" : "Enviar")}
          </button>

          {result?.ok && (
            <div style={{ marginTop: 10, color: "var(--green)", fontSize: 13 }}>
              ✓ Enviado a {result.inserted} usuario{result.inserted === 1 ? "" : "s"}.
            </div>
          )}
          {result?.error && (
            <div style={{ marginTop: 10, color: "var(--red)", fontSize: 13 }}>✗ {result.error}</div>
          )}
        </form>
      </AdminPage.Section>
    </AdminPage>
  );
}
