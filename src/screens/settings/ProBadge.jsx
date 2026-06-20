// Small "PRO" pill rendered next to gated row titles. Visual cue that
// the row needs an active subscription before it'll do anything.
// Charcoal-on-cream so it reads clearly without screaming for
// attention — Cardigan's badges throughout the app share this tone.
export function ProBadge() {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
      padding: "2px 6px", borderRadius: 999,
      background: "var(--charcoal)", color: "var(--white)",
      lineHeight: 1.2,
    }}>PRO</span>
  );
}
