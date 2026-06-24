/* ── NoteTagPicker ────────────────────────────────────────────────
   In-sheet tag editor mounted inside the Notes props sheet (and any
   future place that wants per-note tag management). Three regions:

     1. Linked chips — current tags on this note. Tap any chip's "×"
        to unlink. Color comes from the tag row when set; otherwise
        a teal-mist default that reads as "neutral but present."

     2. Free-text input — type a label + Enter creates the tag if
        new (upsertTag dedups by canonical hash) and links it to the
        note in one action. Reuses the .input pattern so the iOS
        16px floor + dark-mode tokens come for free.

     3. Suggestions — the user's other tags (not yet linked to this
        note), ranked by recency. Tap to link. Capped at 8 to keep
        the sheet from growing tall.

   The component is intentionally dumb-ish: every mutation goes
   through the context handler (upsertTag / linkTag / unlinkTag)
   which threads through the offline queue. Optimistic updates
   happen at the action layer, so the local chip set re-renders
   from props on the next tick. */

import { useState, useMemo } from "react";
import { IconX } from "../Icons";

interface Tag { id: string; label?: string; color?: string | null }
interface TagLink { note_id: string; tag_id: string }

export function NoteTagPicker({ noteId, tags, tagLinks, upsertTag, linkTag, unlinkTag }: {
  noteId?: string;
  tags?: Tag[];
  tagLinks?: TagLink[];
  upsertTag?: (input: { label: string }) => Promise<{ id?: string } | null | undefined> | { id?: string } | null | undefined;
  linkTag?: (noteId: string, tagId: string) => void | Promise<unknown>;
  unlinkTag?: (noteId: string, tagId: string) => void | Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const linkedIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of (tagLinks || [])) if (l.note_id === noteId) s.add(l.tag_id);
    return s;
  }, [tagLinks, noteId]);

  const linked = useMemo(
    () => (tags || []).filter(t => linkedIds.has(t.id)),
    [tags, linkedIds],
  );
  const suggestions = useMemo(
    () => (tags || []).filter(t => !linkedIds.has(t.id)).slice(0, 8),
    [tags, linkedIds],
  );

  async function addFromInput() {
    const label = draft.trim();
    if (!label || busy || !noteId) return;
    setBusy(true);
    try {
      const tag = await upsertTag?.({ label });
      if (tag?.id) await linkTag?.(noteId, tag.id);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="input-group">
      <label className="input-label">Etiquetas</label>

      {linked.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {linked.map(tag => (
            <span key={tag.id} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              height: 28, padding: "0 4px 0 10px",
              borderRadius: "var(--radius-pill)",
              background: tag.color || "var(--teal-mist)",
              color: "var(--teal-dark)",
              fontSize: 12, fontWeight: 700,
            }}>
              <span style={{
                maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{tag.label || "—"}</span>
              <button type="button" className="btn-tap"
                aria-label={`Quitar etiqueta ${tag.label || ""}`}
                onClick={() => { if (noteId) unlinkTag?.(noteId, tag.id); }}
                style={{
                  width: 22, height: 22, minWidth: 22, minHeight: 22,
                  borderRadius: "50%", background: "var(--border-lt)",
                  border: "none", color: "inherit", cursor: "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  padding: 0,
                }}>
                <IconX size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        className="input"
        type="text"
        placeholder="Nueva etiqueta + Enter"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addFromInput(); } }}
        disabled={busy}
      />

      {suggestions.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8,
        }}>
          {suggestions.map(tag => (
            <button key={tag.id} type="button" className="btn-tap"
              onClick={() => { if (noteId) linkTag?.(noteId, tag.id); }}
              style={{
                height: 26, padding: "0 10px",
                borderRadius: "var(--radius-pill)",
                border: "1px dashed var(--border-lt)",
                background: "var(--white)",
                color: "var(--charcoal-md)",
                fontSize: 11, fontWeight: 600,
                cursor: "pointer",
                maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
              + {tag.label || "—"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
