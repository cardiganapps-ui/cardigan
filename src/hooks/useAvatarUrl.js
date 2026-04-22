import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { resolveAvatar } from "../utils/avatarMeta";

/* ── Resolve user_metadata.avatar into render props ─────────────────
   Uploaded avatars live in a private R2 bucket, so this hook asks
   the existing /api/document-url serverless function for a presigned
   GET URL. URLs are cached module-level for the life of the tab so
   the drawer / chrome / settings card don't each issue separate
   presign requests for the same image.

   Presigned URLs are valid 1 hour — longer than a typical session.
   If one expires mid-session, <Avatar>'s onError silently falls back
   to initials; the next mount re-fetches. */

const urlCache = new Map();

async function fetchSignedUrl(path) {
  if (urlCache.has(path)) return urlCache.get(path);
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  const res = await fetch("/api/document-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) return null;
  const { url } = await res.json();
  if (url) urlCache.set(path, url);
  return url || null;
}

export function invalidateAvatarUrl(path) {
  if (path) urlCache.delete(path);
}

export function useAvatarUrl(avatar) {
  const resolved = resolveAvatar(avatar);
  const [imageUrl, setImageUrl] = useState(() =>
    resolved.kind === "uploaded" ? urlCache.get(resolved.path) || null : null
  );
  const lastPathRef = useRef(null);

  useEffect(() => {
    if (resolved.kind !== "uploaded") {
      if (imageUrl !== null) setImageUrl(null);
      lastPathRef.current = null;
      return;
    }
    if (lastPathRef.current === resolved.path) return;
    lastPathRef.current = resolved.path;
    const cached = urlCache.get(resolved.path);
    if (cached) { setImageUrl(cached); return; }
    let active = true;
    fetchSignedUrl(resolved.path).then(url => {
      if (active) setImageUrl(url);
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.kind, resolved.kind === "uploaded" ? resolved.path : null]);

  return { imageUrl };
}
