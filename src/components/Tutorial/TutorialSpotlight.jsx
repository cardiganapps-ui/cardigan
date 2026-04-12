// Spotlight overlay: a single absolutely-positioned div with a massive box-shadow
// that dims the rest of the viewport. Falls back to a full-screen dim layer
// when there is no target rect (welcome / done / centered step).
//
// The spotlight itself has `pointer-events: none` (purely visual), so to keep
// the rest of the UI from being clickable during a step we render four
// transparent "blocker" divs around the cutout rect. Only the cutout itself
// stays interactive, so the user can only tap the element being showcased.

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
      <div className="tut-spotlight" style={style} aria-hidden="true" />
    </>
  );
}
