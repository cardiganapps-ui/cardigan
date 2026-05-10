// Spotlight overlay: a single absolutely-positioned div with a massive box-shadow
// that dims the rest of the viewport. Falls back to a full-screen dim layer
// when there is no target rect (welcome / done / centered step).
//
// The spotlight itself has `pointer-events: none` (purely visual). Five
// transparent "blocker" divs (4 around + 1 inside) intercept clicks on
// every other surface, so users have to use the tooltip's Next/Prev to
// advance — they can't accidentally navigate by tapping a kpi tile or
// the hamburger framed by the spotlight.
//
// The one element that stays tappable through the cutout is the FAB,
// which gets z-index-boosted ABOVE the inner blocker via the
// `body.tut-fab-active .fab` rule in tutorial.css. That preserves the
// "tap this to test it" affordance for the FAB step without leaving
// every other framed element hot.

export function TutorialSpotlight({ rect, padding = 8 }) {
  if (!rect) {
    return <div className="tut-dim" />;
  }
  const p = padding;
  const top = Math.max(0, rect.top - p);
  const left = Math.max(0, rect.left - p);
  const width = rect.width + p * 2;
  const height = rect.height + p * 2;
  const right = left + width;
  const bottom = top + height;
  const style = { top, left, width, height };
  return (
    <>
      {/* Click blockers around the spotlight cutout */}
      <div
        className="tut-blocker"
        style={{ top: 0, left: 0, width: "100vw", height: top }}
        aria-hidden="true"
      />
      <div
        className="tut-blocker"
        style={{ top: bottom, left: 0, width: "100vw", bottom: 0 }}
        aria-hidden="true"
      />
      <div
        className="tut-blocker"
        style={{ top, left: 0, width: left, height }}
        aria-hidden="true"
      />
      <div
        className="tut-blocker"
        style={{ top, left: right, right: 0, height }}
        aria-hidden="true"
      />
      {/* Inner blocker — covers the cutout area itself so tapping a
          framed kpi tile / hamburger / nav-item doesn't fire its
          underlying onClick. The FAB step still works because the FAB
          is z-boosted above this layer (see body.tut-fab-active .fab). */}
      <div
        className="tut-blocker"
        style={style}
        aria-hidden="true"
      />
      <div className="tut-spotlight" style={style} aria-hidden="true" />
    </>
  );
}
