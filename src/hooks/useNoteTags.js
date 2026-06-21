import { supabase } from "../supabaseClient";
import { enqueue, registerHandler } from "../lib/mutationQueue";
import { hashTagLabel, canonicalizeTagLabel } from "../lib/cryptoNotes";

/* createNoteTagActions
   Phase 1.3 of the Notes premium rollout. Tag CRUD + note↔tag link
   management. `crypto` is the same bag useNotes.js consumes — when
   crypto.canEncrypt is true, tag labels go to disk as ciphertext
   under the master key; when not, plaintext. Either way label_hash
   is the deterministic SHA-256 over the canonical form so the DB's
   (user_id, label_hash) unique constraint dedupes silently across
   case + diacritic variations. */

registerHandler("note_tags.upsert", async ({ row }) => {
  return await supabase.from("note_tags").upsert(row, { onConflict: "user_id,label_hash" }).select().single();
});
registerHandler("note_tags.delete", async ({ id, userId }) => {
  return await supabase.from("note_tags").delete().eq("id", id).eq("user_id", userId);
});
registerHandler("note_tag_links.upsert", async ({ noteId, tagId }) => {
  // The PK on (note_id, tag_id) makes this idempotent. ignoreDuplicates
  // keeps the replay clean if a second drain hits the same insert.
  return await supabase.from("note_tag_links").upsert({ note_id: noteId, tag_id: tagId }, { ignoreDuplicates: true });
});
registerHandler("note_tag_links.delete", async ({ noteId, tagId }) => {
  return await supabase.from("note_tag_links").delete().eq("note_id", noteId).eq("tag_id", tagId);
});

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function createNoteTagActions(userId, tags, setTags, tagLinks, setTagLinks, setMutationError, crypto) {

  // Upsert by canonical label hash so the SAME tag name (regardless
  // of case / diacritics) maps to the same row. Returns the tag row
  // — either the existing one or the just-inserted one. The optimistic
  // path adds a temp row when no match exists locally; the replay
  // listener (TODO Phase 1.3.5) reconciles to the server id.
  async function upsertTag({ label, color }) {
    setMutationError("");
    const trimmed = (label || "").trim();
    if (!trimmed) return null;
    // Display label preserves the user's casing for echo back to the
    // UI; the hash is over the canonical form so dedup ignores it.
    const hash = await hashTagLabel(trimmed);
    const existing = (tags || []).find(t => t.label_hash === hash);
    if (existing && (color == null || existing.color === color)) return existing;

    // Reuse the canonical crypto.encrypt() — returns plaintext + flag
    // when the user has note encryption disabled, ciphertext + flag
    // when enabled. Same envelope used for note content.
    const enc = crypto?.encrypt
      ? await crypto.encrypt(trimmed)
      : { content: trimmed, encrypted: false };
    const row = {
      user_id: userId,
      label_ciphertext: enc.content,
      label_hash: hash,
      color: color || null,
    };
    const encrypted = enc.encrypted;

    if (isOffline()) {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const local = { id: tempId, ...row, label: trimmed, encrypted, _optimistic: true };
      setTags(prev => existing ? prev.map(t => t.label_hash === hash ? local : t) : [local, ...prev]);
      await enqueue("note_tags.upsert", { row });
      return local;
    }

    const res = await supabase.from("note_tags").upsert(row, { onConflict: "user_id,label_hash" }).select().single();
    if (res.error) { setMutationError(res.error.message); return null; }
    // Decorate with the user-typed label so the UI shows it without
    // a round-trip through decrypt (server stored ciphertext when
    // crypto is on).
    const decorated = { ...res.data, label: trimmed, encrypted };
    setTags(prev => {
      const without = prev.filter(t => t.label_hash !== hash);
      return [decorated, ...without];
    });
    // canonicalizeTagLabel is unused but exposed for callers (e.g.
    // TagPicker) that want to short-circuit a same-canonical dupe.
    void canonicalizeTagLabel;
    return decorated;
  }

  async function deleteTag(id) {
    setMutationError("");
    const prev = (tags || []).find(t => t.id === id);
    if (!prev) return false;
    setTags(arr => arr.filter(t => t.id !== id));
    setTagLinks(arr => (arr || []).filter(l => l.tag_id !== id));
    // Temp-id tags never made it to the server; nothing to delete remotely.
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("note_tags.delete", { id, userId });
      return true;
    }
    const res = await supabase.from("note_tags").delete().eq("id", id).eq("user_id", userId);
    if (res.error) {
      setTags(arr => [prev, ...arr]);
      setMutationError(res.error.message);
      return false;
    }
    return true;
  }

  async function linkTag(noteId, tagId) {
    setMutationError("");
    if (!noteId || !tagId) return false;
    // Idempotent locally — Set semantics on (noteId, tagId).
    setTagLinks(arr => {
      const cur = arr || [];
      if (cur.some(l => l.note_id === noteId && l.tag_id === tagId)) return cur;
      return [...cur, { note_id: noteId, tag_id: tagId }];
    });
    if (isOffline() || (typeof tagId === "string" && tagId.startsWith("temp-"))) {
      // Offline link OR link to a still-pending temp tag — queue for
      // replay. The tag upsert handler runs first (queue is FIFO), so
      // by the time the link replays the tag exists server-side.
      await enqueue("note_tag_links.upsert", { noteId, tagId });
      return true;
    }
    const res = await supabase.from("note_tag_links").upsert({ note_id: noteId, tag_id: tagId }, { ignoreDuplicates: true });
    if (res.error) { setMutationError(res.error.message); return false; }
    return true;
  }

  async function unlinkTag(noteId, tagId) {
    setMutationError("");
    setTagLinks(arr => (arr || []).filter(l => !(l.note_id === noteId && l.tag_id === tagId)));
    if (isOffline()) {
      await enqueue("note_tag_links.delete", { noteId, tagId });
      return true;
    }
    const res = await supabase.from("note_tag_links").delete().eq("note_id", noteId).eq("tag_id", tagId);
    if (res.error) { setMutationError(res.error.message); return false; }
    return true;
  }

  return { upsertTag, deleteTag, linkTag, unlinkTag };
}
