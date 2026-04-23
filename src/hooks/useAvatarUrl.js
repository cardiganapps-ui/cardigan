import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { resolveAvatar } from "../utils/avatarMeta";

/* ── Resolve user_metadata.avatar into render props ─────────────────
   Two shapes the hook returns an imageUrl for:

     preset   — derived synchronously from the avatar id, served as
                a static SVG out of /avatars/. No network, no state.
     uploaded — lives in a private R2 bucket; we ask /api/document-url
                for a presigned GET URL and cache module-level so the
                drawer / chrome / settings card share one lookup.

   Presets compute synchronously and bypass React state entirely so a
   user saving a preset sees every avatar surface (Drawer header,
   top-right chrome, Settings card) update in the same render. The
   earlier useState+useEffect variant occasionally left chrome
   surfaces stuck on initials because the effect didn't re-run under
   some render timing. */

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
  const uploadedPath = resolved.kind === "uploaded" ? resolved.path : null;
  const [uploadedUrl, setUploadedUrl] = useState(() =>
    uploadedPath ? urlCache.get(uploadedPath) || null : null
  );
  const lastPathRef = useRef(null);

  useEffect(() => {
    if (!uploadedPath) {
      if (uploadedUrl !== null) setUploadedUrl(null);
      lastPathRef.current = null;
      return;
    }
    if (lastPathRef.current === uploadedPath) return;
    lastPathRef.current = uploadedPath;
    const cached = urlCache.get(uploadedPath);
    if (cached) { setUploadedUrl(cached); return; }
    let active = true;
    fetchSignedUrl(uploadedPath).then(url => {
      if (active) setUploadedUrl(url);
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedPath]);

  const imageUrl =
    resolved.kind === "preset"   ? resolved.url :
    resolved.kind === "uploaded" ? uploadedUrl :
    null;

  return { imageUrl };
}
