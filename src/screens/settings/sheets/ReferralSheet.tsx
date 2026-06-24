import { useT } from "../../../i18n/index";
import { IconX, IconUsers } from "../../../components/Icons";
import { ReferralShareBlock } from "../../../components/ReferralShareBlock";
import { formatMXNCents, formatDate } from "../../../utils/format";
import { SheetOverlay } from "../../../components/SheetOverlay";

/* ── Referral / "Invita y gana" sheet ─────────────────────────────────
   Extracted from Settings.tsx. PRESENTATIONAL: the subscription bag
   (referralInfo / leaderboard) and the copy-to-clipboard handler stay in
   Settings and thread in as same-name props, so the JSX moved verbatim.
   Shared focus-trap + drag wiring threads through setSheetPanel /
   sheetPanelHandlers. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// Spanish "hace X" relative time for the referral leaderboard. Days
// rounded down so "hace 1 día" doesn't slip to "hace 0 días" on the
// 23rd hour. Anything older than 30 days falls back to a calendar
// date so the leaderboard doesn't read as a stale-feeling "hace 200
// días" list.
function relativeTime(iso: string | null | undefined) {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} ${mins === 1 ? "min" : "mins"}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} ${hrs === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  return formatDate(then, "shortYear");
}

export interface ReferralSheetProps {
  open: boolean;
  subscription: Row;
  referralCopied: boolean;
  copyReferralCode: () => void | Promise<void>;
  setActiveSheet: (key: string | null) => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function ReferralSheet({
  open, subscription, referralCopied, copyReferralCode,
  setActiveSheet, setSheetPanel, sheetPanelHandlers,
}: ReferralSheetProps) {
  const { t } = useT();
  if (!open) return null;
  return (
        <SheetOverlay onClose={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.referralRowTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {(() => {
                const info = subscription?.referralInfo;
                return (
                  <>
                    <div style={{
                      padding:"22px 18px",
                      borderRadius:"var(--radius-lg, 16px)",
                      background:"var(--teal-pale)",
                      textAlign:"center",
                      marginBottom:14,
                    }}>
                      <div style={{ width:52, height:52, borderRadius:"50%",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        background:"var(--white)", color:"var(--teal-dark)",
                        margin:"0 auto 10px", boxShadow:"var(--shadow-sm)" }}>
                        <IconUsers size={22} />
                      </div>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.2px" }}>
                        {t("subscription.referralTitle")}
                      </div>
                      <div style={{ fontSize:13, color:"var(--charcoal-md)", marginTop:6, lineHeight:1.5 }}>
                        {t("subscription.referralExplain")}
                      </div>
                    </div>

                    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"14px 16px", background:"var(--white)", border:"1px solid var(--border)", borderRadius:"var(--radius)", marginBottom:14 }}>
                      <div style={{ flex:1, fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)", letterSpacing:"0.2em" }}>
                        {info?.code || (subscription?.referralLoading ? "…" : "—")}
                      </div>
                      <button type="button" className="btn btn-ghost" onClick={copyReferralCode}
                        disabled={!info?.code}
                        style={{ minWidth:96, height:36, fontSize:"var(--text-sm)" }}>
                        {referralCopied ? t("subscription.shareCopied") : t("subscription.shareCopyLink")}
                      </button>
                    </div>

                    {/* Native + per-channel share. The OS share sheet
                        (navigator.share) covers every app the user has
                        installed — Messages, Mail, Telegram, IG, Notes,
                        AirDrop, etc. — and is the primary CTA when
                        available. The icon row below it is the direct
                        path for the most common Mexican channels and
                        the desktop fallback. Each path tracks a
                        `referral_share` event with the channel name
                        for funnel analysis. */}
                    {info?.code && <ReferralShareBlock code={info.code} t={t} />}
                    {info && info.rewardsCount > 0 && (
                      <div style={{ fontSize:13, color:"var(--charcoal-md)", lineHeight:1.5, padding:"4px 4px 0" }}>
                        {info.pendingCreditCents > 0
                          ? t("subscription.referralRewardsPending", {
                              n: info.rewardsCount,
                              credit: `${formatMXNCents(info.pendingCreditCents)}`,
                            })
                          : t("subscription.referralRewardsApplied", { n: info.rewardsCount })}
                      </div>
                    )}

                    {/* Leaderboard — invitees who actually converted, with
                        a relative timestamp. The names are intentionally
                        absent (we don't share emails between users); the
                        list anchors the rewards count in something the
                        user can see and feel. */}
                    {Array.isArray(subscription?.referralLeaderboard) && subscription.referralLeaderboard.length > 0 && (
                      <div style={{ marginTop:18 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
                          {t("subscription.referralLeaderboardTitle")}
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                          {subscription.referralLeaderboard.map((row: Row, idx: number) => (
                            <div key={row.id} style={{
                              display:"flex", alignItems:"center", justifyContent:"space-between",
                              padding:"10px 12px",
                              background:"var(--white)",
                              border:"1px solid var(--border)",
                              borderRadius:"var(--radius)",
                              fontSize:13,
                              color:"var(--charcoal)",
                            }}>
                              <span>
                                {t("subscription.referralLeaderboardRow", { n: idx + 1 })}
                              </span>
                              <span style={{ color:"var(--charcoal-md)", fontSize:12 }}>
                                {relativeTime(row.credited_at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </SheetOverlay>
  );
}
