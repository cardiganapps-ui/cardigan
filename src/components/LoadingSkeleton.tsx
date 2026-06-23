import React, { useState, useEffect } from "react";

/* ── LoadingSkeleton ──
   Shown on first load (before any data has been fetched) instead of a
   blank screen or a bare "Cargando..." line. Five layout-matched
   variants — home / agenda / patients / finances / documents — so
   the skeleton's shape lines up with where the real content will
   land. The skeleton-to-content swap then reads as "the same screen
   filling in" rather than "two different screens cross-fading".
   Falls back to a generic "header + list" skeleton for any screen
   not yet specialised (Settings, admin dashboard, etc.).

   Extracted verbatim from App.tsx as part of the AppShell split — it's
   pure presentational (no app state), so it lives in components/ and
   the shell just imports it for its Suspense fallbacks. */
export function LoadingSkeleton({ screen = "home" }: { screen?: string }) {
  const skeletonAvatarRow = (key: number, idx: number) => (
    <div key={key} className="row-item" style={{ cursor:"default" }}>
      <div className="sk-circle" />
      <div className="row-content">
        <div className="sk-bar sk-bar-md" style={{ width:`${45 + (idx * 7) % 35}%`, marginBottom:6 }} />
        <div className="sk-bar sk-bar-xs" style={{ width:`${25 + (idx * 11) % 25}%` }} />
      </div>
    </div>
  );

  if (screen === "agenda") {
    // Agenda's primary view is the day list — a header strip with
    // weekday tiles, then a list of session rows. Skeleton matches
    // both so the day-strip → session-list handoff is seamless.
    return (
      <div className="page" aria-hidden>
        <div style={{ padding:"16px 16px 8px" }}>
          <div className="sk-bar sk-bar-md" style={{ width:"35%", marginBottom:14 }} />
          <div style={{ display:"flex", gap:8 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ flex:1, padding:"10px 4px", borderRadius:"var(--radius)", background:"var(--white)", border:"1px solid var(--border)", textAlign:"center" }}>
                <div className="sk-bar sk-bar-xs" style={{ width:"60%", margin:"0 auto 6px" }} />
                <div className="sk-bar sk-bar-md" style={{ width:"40%", margin:"0 auto" }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding:"12px 16px 0" }}>
          <div className="card">
            {Array.from({ length: 5 }).map((_, i) => skeletonAvatarRow(i, i))}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "finances") {
    // Finances has the same KPI-tiles-then-list shape as Home, just
    // 4-up always. Mirror that so the swap doesn't reflow the page.
    return (
      <div className="page" aria-hidden>
        <div style={{ padding:"16px 16px 4px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="kpi-card">
              <div className="sk-bar sk-bar-sm" style={{ width:"55%", marginBottom:10 }} />
              <div className="sk-bar sk-bar-lg" style={{ width:"70%", marginBottom:6 }} />
              <div className="sk-bar sk-bar-xs" style={{ width:"40%" }} />
            </div>
          ))}
        </div>
        <div style={{ padding:"16px 16px 0" }}>
          <div className="sk-bar sk-bar-md" style={{ width:"40%", marginBottom:12 }} />
          <div className="card">
            {Array.from({ length: 5 }).map((_, i) => skeletonAvatarRow(i, i))}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "documents" || screen === "archivo") {
    // Documents — filter chip strip, then a card with file rows. The
    // file rows have a square thumb + name + meta, so the skeleton
    // mirrors that instead of the round-avatar shape.
    return (
      <div className="page" aria-hidden>
        <div style={{ padding:"16px 16px 12px" }}>
          <div className="sk-bar sk-bar-md" style={{ width:"45%", marginBottom:14 }} />
          <div style={{ display:"flex", gap:8 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="sk-bar sk-bar-md" style={{ width: 70 + i*8, height: 30, borderRadius: 999 }} />
            ))}
          </div>
        </div>
        <div style={{ padding:"0 16px" }}>
          <div className="card">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="row-item" style={{ cursor:"default" }}>
                <div className="sk-bar" style={{ width:36, height:36, borderRadius:8 }} />
                <div className="row-content" style={{ marginLeft:12 }}>
                  <div className="sk-bar sk-bar-md" style={{ width:`${45 + (i * 9) % 30}%`, marginBottom:6 }} />
                  <div className="sk-bar sk-bar-xs" style={{ width:`${20 + (i * 7) % 20}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (screen !== "home") {
    return (
      <div className="page" aria-hidden>
        <div style={{ padding:"20px 16px 10px" }}>
          <div className="sk-bar sk-bar-lg" style={{ width:"40%", marginBottom:8 }} />
          <div className="sk-bar sk-bar-sm" style={{ width:"60%" }} />
        </div>
        <div style={{ padding:"0 16px" }}>
          <div className="card">
            {Array.from({ length: 6 }).map((_, i) => skeletonAvatarRow(i, i))}
          </div>
        </div>
      </div>
    );
  }
  // Home variant — the only screen with the KPI-tiles + carousel
  // layout, so it gets a bespoke skeleton matching that shape. The
  // generic skeletonAvatarRow above is reused for the list rows.
  const skeletonRow = (key: number) => skeletonAvatarRow(key, key);
  return (
    <div className="page" aria-hidden>
      {/* Match real Home's classes so the responsive rules kick in —
         kpi-grid-desktop → 4-col on iPad+, home-columns + .home-col-*
         give the right main/side split at each breakpoint. Without
         these the skeleton stayed at 2-col KPIs + single narrow card,
         which read as "too narrow" on iPad landscape. */}
      <div className="kpi-grid-desktop" style={{ padding:"16px 16px 4px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kpi-card">
            <div className="sk-bar sk-bar-sm" style={{ width:"50%", marginBottom:10 }} />
            <div className="sk-bar sk-bar-lg" style={{ width:"70%", marginBottom:6 }} />
            <div className="sk-bar sk-bar-xs" style={{ width:"40%" }} />
          </div>
        ))}
      </div>
      <div className="home-columns">
        <div className="section home-col-main">
          <div className="section-header home-carousel" style={{ padding:"0 16px 8px" }}>
            <div className="sk-bar sk-bar-sm" style={{ width:"45%" }} />
          </div>
          {/* Mobile/iPad portrait: single card (carousel panel stand-in) */}
          <div className="home-carousel" style={{ padding:"0 16px" }}>
            <div className="card">
              {Array.from({ length: 3 }).map((_, i) => skeletonRow(i))}
            </div>
          </div>
          {/* Tablet/desktop: Hoy + Mañana stacked section cards */}
          <div className="home-schedule-desktop">
            {Array.from({ length: 2 }).map((_, p) => (
              <div key={p} className="section">
                <div className="section-header">
                  <div className="section-headline">
                    <div className="sk-bar sk-bar-sm" style={{ width:80, marginBottom:5 }} />
                    <div className="sk-bar sk-bar-xs" style={{ width:64 }} />
                  </div>
                </div>
                <div className="card">
                  {Array.from({ length: 3 }).map((_, i) => skeletonRow(i))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="home-col-side">
          {Array.from({ length: 2 }).map((_, s) => (
            <div key={s} className="section">
              <div className="section-header">
                <div className="sk-bar sk-bar-sm" style={{ width:"40%" }} />
              </div>
              <div className="card">
                {Array.from({ length: 3 }).map((_, i) => skeletonRow(i))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── SkeletonCrossfade ──
   Wraps the first-load swap from LoadingSkeleton → real content with
   a 250ms crossfade so the transition doesn't read as a hard cut.
   When `showContent` flips true, both layers remain mounted for the
   fade duration: content fades in from 0 while the skeleton fades out
   on top, giving the eye a continuous handoff. */
type SkeletonCrossfadeProps = {
  showContent: boolean;
  skeletonScreen?: string;
  children: React.ReactNode;
};

export function SkeletonCrossfade({ showContent, skeletonScreen, children }: SkeletonCrossfadeProps) {
  const [keepSkeleton, setKeepSkeleton] = useState(!showContent);
  useEffect(() => {
    if (showContent && keepSkeleton) {
      const id = setTimeout(() => setKeepSkeleton(false), 260);
      return () => clearTimeout(id);
    }
    // Re-raise the skeleton when the app transitions back to loading
    // (rare — pull-to-refresh while the patient list is empty). The
    // set is synchronous in the effect on purpose: the skeleton needs
    // to be visible in the same frame we lose the content.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!showContent && !keepSkeleton) setKeepSkeleton(true);
  }, [showContent, keepSkeleton]);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {showContent && (
        <div style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
          animation: keepSkeleton ? "fadeIn 0.25s ease" : undefined,
        }}>
          {children}
        </div>
      )}
      {keepSkeleton && (
        <div style={{
          position: showContent ? "absolute" : "static",
          inset: 0,
          flex: showContent ? undefined : 1,
          minHeight: 0,
          display: "flex", flexDirection: "column",
          animation: showContent ? "fadeOut 0.25s ease forwards" : undefined,
          pointerEvents: showContent ? "none" : undefined,
        }}>
          <LoadingSkeleton screen={skeletonScreen} />
        </div>
      )}
    </div>
  );
}
