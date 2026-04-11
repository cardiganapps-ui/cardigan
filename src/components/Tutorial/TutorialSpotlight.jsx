// Spotlight overlay: a single absolutely-positioned div with a massive box-shadow
// that dims the rest of the viewport. Falls back to a full-screen dim layer
// when there is no target rect (welcome / done / centered step).

export function TutorialSpotlight({ rect, padding = 8 }) {
  if (!rect) {
    return <div className="tut-dim" />;
  }
  const p = padding;
  const style = {
    top: Math.max(0, rect.top - p),
    left: Math.max(0, rect.left - p),
    width: rect.width + p * 2,
    height: rect.height + p * 2,
  };
  return <div className="tut-spotlight" style={style} aria-hidden="true" />;
}
