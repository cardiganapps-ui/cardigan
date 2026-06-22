import { IconMail } from "./Icons";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";
import { track } from "../lib/analytics";
import { isSharingSupported, shareContent } from "../lib/nativeShare";

/* Official WhatsApp glyph (SimpleIcons, CC0). The previous icon was
   a hand-rolled approximation that read as a generic chat bubble.
   Using the brand mark verbatim avoids the "is that the right app?"
   moment when users see the button on iOS Safari. Exported so other
   share surfaces (InvitePatientSheet, etc.) reuse the exact mark. */
export function WhatsAppGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/* iOS-style share glyph (the box-with-up-arrow). Signals "system
   share sheet" on iOS Safari and matches modern share buttons on
   Android Chrome too. Exported for reuse on other share surfaces. */
export function ShareGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v13" />
      <polyline points="7 8 12 3 17 8" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

/* ── Referral share block ──
   Three-tier share UI:
     1. Primary: native OS share (navigator.share) — covers every
        app the user has installed. Hidden on browsers without the
        Web Share API (mostly older desktop builds).
     2. Direct icon row: WhatsApp + Email. The most common channels
        in Mexico, deep-linked so they work even when navigator.share
        is unavailable.
     3. Code box + Copiar enlace (rendered by the caller; we only
        own the share buttons themselves) for the manual case.

   Each tap fires `referral_share` with `channel` so we can see in
   Vercel Analytics which path actually drives invitations. */
export function ReferralShareBlock({ code, t: tProp }: { code?: string; t?: (key: string, vars?: Record<string, unknown>) => string }) {
  const { t: tHook } = useT();
  // Accept an explicit `t` for callers that want to mirror the same
  // i18n instance — Settings.jsx historically passed it down. Falls
  // back to the hook so nothing's required.
  const t = tProp || tHook;
  const url = `https://cardigan.mx/?ref=${code}`;
  const text = t("subscription.referralShareText", { code });
  // True on iOS Safari, Android Chrome, and inside the native shell on
  // both platforms (Capacitor Share plugin). Hidden only on older
  // desktop browsers, where the WhatsApp + Email row below is the
  // primary share surface.
  const canNativeShare = isSharingSupported();

  const fireTrack = (channel: string) => {
    track("referral_share", { channel });
  };

  const handleNativeShare = async () => {
    haptic.tap();
    const res = await shareContent({ title: "Cardigan", text, url });
    if (res.ok) fireTrack("native");
    else if (!res.aborted && res.error) console.warn("share:", res.error);
  };

  const onChannel = (channel: string) => () => {
    haptic.tap();
    fireTrack(channel);
  };

  return (
    <>
      {canNativeShare && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleNativeShare}
          style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:14 }}>
          <ShareGlyph size={16} />
          <span>{t("subscription.shareNative")}</span>
        </button>
      )}

      {/* Section divider — only renders when there's a primary
          button above to separate from. On desktop where native
          share is hidden, the icon row is the primary surface and
          we drop the eyebrow to keep it tight. */}
      {canNativeShare && (
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--charcoal-md)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 10,
          textAlign: "center",
        }}>
          {t("subscription.shareDirectEyebrow")}
        </div>
      )}

      {/* Icon row — equal-width tiles so the buttons read as a
          coherent set rather than three random pills. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        marginBottom: 4,
      }}>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onChannel("whatsapp")}
          className="referral-channel-btn"
          style={{ background: "var(--social-whatsapp)", color: "var(--social-on-brand)" }}
          aria-label="WhatsApp">
          <WhatsAppGlyph size={20} />
          <span>WhatsApp</span>
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent("Te invito a Cardigan")}&body=${encodeURIComponent(text)}`}
          onClick={onChannel("email")}
          className="referral-channel-btn"
          // Theme-constant brand pill: --social-dark / --social-on-brand
          // deliberately do NOT flip in dark mode (var(--charcoal)
          // would invert to light grey and the white label would vanish).
          style={{ background: "var(--social-dark)", color: "var(--social-on-brand)" }}
          aria-label={t("subscription.shareEmail")}>
          <IconMail size={18} />
          <span>{t("subscription.shareEmail")}</span>
        </a>
      </div>
    </>
  );
}
