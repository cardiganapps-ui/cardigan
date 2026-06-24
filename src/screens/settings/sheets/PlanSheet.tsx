import { useT } from "../../../i18n/index";
import { IconX, IconCheck, IconStar, IconSparkle, IconLock } from "../../../components/Icons";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { ProValueWidget } from "../../../components/ProValueWidget";
import { billingSummary } from "../../../utils/subscriptionStatus";
import { formatMXNCents, formatDate } from "../../../utils/format";
import { isNative, isIOS } from "../../../lib/platform";

/* ── Plan / Suscripción sheet ─────────────────────────────────────────
   Extracted from Settings.tsx — the largest single sheet (status hero,
   pricing toggle, invoice link, checkout / portal / sync actions,
   invite-code field). This is a PRESENTATIONAL extraction: all the
   subscription/referral STATE + the checkout/portal/sync handlers stay in
   Settings (revenue-critical logic, untouched) and are threaded in as
   props with the same names, so the JSX moved here verbatim. Shared
   focus-trap + drag wiring threads through setSheetPanel /
   sheetPanelHandlers. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface PlanSheetProps {
  open: boolean;
  subscription: Row;
  subBusy: boolean;
  subError: string;
  selectedPlan: string;
  setSelectedPlan: (v: string) => void;
  inviteCodeInput: string;
  setInviteCodeInput: (v: string) => void;
  inviteCodeFromUrl: boolean;
  syncBusy: boolean;
  syncDone: boolean;
  handleStartCheckout: () => void;
  handleOpenPortal: () => void | Promise<void>;
  handleSyncWithStripe: () => void | Promise<void>;
  setActiveSheet: (key: string | null) => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function PlanSheet({
  open, subscription, subBusy, subError, selectedPlan, setSelectedPlan,
  inviteCodeInput, setInviteCodeInput, inviteCodeFromUrl, syncBusy, syncDone,
  handleStartCheckout, handleOpenPortal, handleSyncWithStripe, setActiveSheet,
  setSheetPanel, sheetPanelHandlers,
}: PlanSheetProps) {
  const { t } = useT();
  if (!open) return null;
  return (
        <div className="sheet-overlay" onClick={() => !subBusy && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.subscriptionTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !subBusy && setActiveSheet(null)} disabled={subBusy}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {(() => {
                const s = subscription || {};
                const state = s.accessState || "loading";
                const isComp = s.compGranted;
                const isActive = s.subscribedActive;
                // past_due means a renewal payment failed; Stripe is
                // retrying behind the scenes. We keep the user on Pro
                // for the grace window (it'd be hostile to lock a
                // therapist out mid-week over a single card glitch),
                // but we DO surface a clear amber warning + a one-tap
                // "fix payment" route into the Stripe portal.
                const isPastDue = s.subscription?.status === "past_due";
                // Admin shortcut: accessState === "active" without
                // a paid sub or comp grant is the admin's own row.
                // Treat it as the same "Activa" hero as a real Pro
                // sub so the panel doesn't read as perpetually
                // loading for the admin.
                const isAdminAccess = !isComp && !isActive && state === "active";
                // Reader-app gate: inside the iOS native shell, App Store
                // Guideline 3.1.3(a) forbids pricing, subscribe CTAs, and
                // any "purchase via website" call to action. Existing
                // subscribers can still see status + manage via the
                // Billing Portal (allowed); only the BUY surfaces hide.
                const isIOSReader = isNative() && isIOS();
                // Structured hero summary — drives the icon tone, the
                // emphasized end-date block, the charge chip, and which
                // secondary action (pause / reactivate / none) to show.
                // Admin's accessState=active without sub/comp falls
                // through to "unknown" in the classifier; we override
                // its hero copy below to match the real-Pro presentation.
                const summary = billingSummary(s);
                const tone = summary.tone || "teal";
                const TONE_COLORS: Record<string, { color: string; bg: string }> = {
                  teal:  { color: "var(--teal-dark)", bg: "var(--teal-pale)" },
                  amber: { color: "var(--amber)",     bg: "var(--amber-bg)" },
                  green: { color: "var(--green)",     bg: "var(--green-bg)" },
                  red:   { color: "var(--red)",       bg: "var(--red-bg)" },
                };
                const accentColor = TONE_COLORS[tone].color;
                const accentBg = TONE_COLORS[tone].bg;
                const HeroIcon = isComp ? IconCheck
                  : isPastDue ? IconStar
                  : (summary.state === "cancelling") ? IconStar
                  : isActive ? IconSparkle
                  : summary.state === "expired" ? IconLock
                  : IconStar;
                // For admin access (no sub, no comp), present as
                // comp-style — they have full access and no charges.
                const heroTitle = isAdminAccess
                  ? t("subscription.statusActiveTitle")
                  : t(summary.title);
                const adminCaption = isAdminAccess ? t("subscription.compExplain") : null;
                return (
                  <>
                    {/* ── Hero card — structured layout: tone-tinted bg, icon
                          medallion, title, divider, emphasized end-date block
                          (caption + big date), and a charge chip. Each piece
                          carries one piece of the "what's happening" answer
                          rather than one dense sentence. Active subs land
                          here whether they're renewing or cancelling — the
                          tone (teal vs amber) + chip text differentiate. */}
                    <div style={{
                      padding: !isComp && !isActive && !isAdminAccess ? "22px 18px 22px" : "22px 18px",
                      borderRadius: "var(--radius-lg, 16px)",
                      marginBottom: 16,
                      background: accentBg,
                      textAlign: "center",
                    }}>
                      <div style={{ width:56, height:56, borderRadius:"50%",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        background:"var(--white)", color: accentColor, margin:"0 auto 12px",
                        boxShadow:"var(--shadow-sm)" }}>
                        <HeroIcon size={24} />
                      </div>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.3px", lineHeight:1.2 }}>
                        {heroTitle}
                      </div>

                      {/* Admin shortcut: replicate the comp-style explanation
                          (no charges, full access) since admins fall through
                          billingSummary to "unknown". */}
                      {isAdminAccess && adminCaption && (
                        <div style={{ fontSize:13, color:"var(--charcoal-md)", marginTop:8, lineHeight:1.5 }}>
                          {adminCaption}
                        </div>
                      )}

                      {/* End-date block — the date is the most consequential
                          piece of info on this card, so it gets display-font
                          weight and size. The caption above ("Próximo cobro"
                          / "Pierdes acceso a Pro" / "Tu prueba termina") tells
                          the user what the date means. */}
                      {summary.endLabel && summary.endCaption && !isAdminAccess && (
                        <div style={{ marginTop:16, paddingTop:14, borderTop:"1px solid var(--border-lt)" }}>
                          <div style={{ fontSize:11, color:"var(--charcoal-xl)", letterSpacing:"0.05em", textTransform:"uppercase", fontWeight:700 }}>
                            {t(summary.endCaption)}
                          </div>
                          <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.4px", marginTop:4, lineHeight:1.15 }}>
                            {summary.endLabel}
                          </div>
                        </div>
                      )}

                      {/* Charge chip — the unambiguous "this is what's
                          happening to your money". Tone-colored pill so a
                          glance separates "$149 every month" (positive)
                          from "Sin cobros futuros" (warning). */}
                      {summary.chipText && !isAdminAccess && (() => {
                        const chipMap: Record<string, { color: string; bg: string }> = {
                          positive: { color: "var(--green)",   bg: "var(--green-bg)" },
                          warning:  { color: "var(--amber)",   bg: "var(--amber-bg)" },
                          danger:   { color: "var(--red)",     bg: "var(--red-bg)" },
                          neutral:  { color: "var(--charcoal-md)", bg: "rgba(0,0,0,0.05)" },
                        };
                        const c = chipMap[summary.chipTone] || chipMap.neutral;
                        const text = summary.chipText.startsWith("subscription.")
                          ? t(summary.chipText)
                          : summary.chipText;
                        return (
                          <div style={{
                            display:"inline-block", marginTop:14,
                            padding:"6px 14px", borderRadius:999,
                            background:c.bg, color:c.color,
                            fontSize:12, fontWeight:700, letterSpacing:"0.01em",
                          }}>
                            {text}
                          </div>
                        );
                      })()}

                      {/* Price line — checkout flow only. Lives inside the
                          hero so the user perceives value + cost together. */}
                      {!isComp && !isActive && !isAdminAccess && !isIOSReader && (
                        <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid var(--border-lt)" }}>
                          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:6 }}>
                            <span style={{ fontFamily:"var(--font-d)", fontSize:34, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-1px", lineHeight:1 }}>
                              ${selectedPlan === "annual" ? "1,490" : "149"}
                            </span>
                            <span style={{ fontSize:13, color:"var(--charcoal-md)", fontWeight:600 }}>
                              {selectedPlan === "annual"
                                ? t("subscription.priceUnitAnnual")
                                : t("subscription.priceUnit")}
                            </span>
                          </div>
                          <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:6 }}>
                            {selectedPlan === "annual"
                              ? t("subscription.priceExplainAnnual")
                              : t("subscription.priceExplain")}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Billing-cycle toggle — only when there's a sale to make.
                        Annual carries a small "ahorra 17%" badge underneath so
                        the discount registers without visual clutter on the
                        toggle itself. */}
                    {!isComp && !isActive && !isAdminAccess && !isIOSReader && (
                      <div style={{ marginBottom:14 }}>
                        <SegmentedControl
                          items={[
                            { k: "monthly", l: t("subscription.pricingToggleMonthly") },
                            { k: "annual", l: t("subscription.pricingToggleAnnual") },
                          ]}
                          value={selectedPlan}
                          onChange={setSelectedPlan}
                          ariaLabel={t("subscription.pricingToggleAriaLabel")}
                        />
                        {selectedPlan === "annual" && (
                          <div style={{ fontSize:12, color:"var(--green)", textAlign:"center", marginTop:8, fontWeight:700 }}>
                            {t("subscription.annualSavingsBadge")}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Latest-invoice row — styled as a quiet card so it
                        reads as a "tap to view" affordance rather than
                        a stray underlined link. */}
                    {isActive && !isPastDue && s.subscription?.hosted_invoice_url && (
                      <a href={s.subscription.hosted_invoice_url}
                        target="_blank" rel="noopener noreferrer"
                        style={{
                          display:"flex", alignItems:"center", justifyContent:"space-between",
                          padding:"12px 14px", marginBottom:14,
                          borderRadius:"var(--radius)",
                          background:"var(--white)",
                          border:"1px solid var(--border)",
                          color:"var(--charcoal)", textDecoration:"none",
                          fontSize:13, fontWeight:600,
                        }}>
                        <span>{t("subscription.viewLatestReceipt")}</span>
                        <span style={{ color:"var(--teal-dark)", fontSize:14 }}>→</span>
                      </a>
                    )}

                    {/* Invite-code input — only when not yet subscribed
                        AND the code wasn't auto-captured from a ?ref=<code>
                        URL. Visitors who arrived via a friend's referral
                        link don't see this field at all; the code is
                        already in inviteCodeInput from sessionStorage and
                        flows through to handleStartCheckout invisibly.
                        Word-of-mouth users (who never hit a ?ref URL)
                        still see the field and can type their code in. */}
                    {!isComp && !isActive && !isAdminAccess && !isIOSReader && !inviteCodeFromUrl && (
                      <div className="input-group" style={{ marginBottom:14 }}>
                        <label className="input-label">{t("subscription.inviteCodeLabel")}</label>
                        <input
                          type="text"
                          className="input"
                          autoCapitalize="characters"
                          autoComplete="off"
                          maxLength={16}
                          placeholder={t("subscription.inviteCodePlaceholder")}
                          value={inviteCodeInput}
                          onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                          disabled={subBusy}
                          style={{ letterSpacing:"0.08em", fontWeight:600 }}
                        />
                        <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:6, lineHeight:1.4 }}>
                          {t("subscription.inviteCodeHint")}
                        </div>
                      </div>
                    )}

                    {subError && <div style={{ fontSize:13, color:"var(--red)", marginBottom:10 }}>{subError}</div>}

                    {/* Primary action — full-width charcoal button on its own row.
                        Active subs swap to "Administrar" pointing at the Stripe portal. */}
                    {(!isComp && !isActive && !isAdminAccess && !isIOSReader) && (
                      <div style={{ marginBottom:22 }}>
                        <button type="button" className="btn btn-primary"
                          onClick={handleStartCheckout} disabled={subBusy}>
                          {subBusy ? t("loading") : t("subscription.subscribeCta")}
                        </button>
                        <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginTop:8, lineHeight:1.4 }}>
                          {t("subscription.checkoutFooter")}
                        </div>
                      </div>
                    )}
                    {/* iOS reader-app substitute — informational only.
                        No button, no link, no pricing — strictly what
                        App Store Guideline 3.1.3(a) permits. */}
                    {(!isComp && !isActive && !isAdminAccess && isIOSReader) && (
                      <div style={{
                        marginBottom: 22,
                        padding: "14px 16px",
                        background: "var(--cream)",
                        borderRadius: "var(--radius)",
                        fontSize: 13, color: "var(--charcoal-md)",
                        lineHeight: 1.5, textAlign: "center",
                      }}>
                        {t("subscription.iosReaderHint")}
                      </div>
                    )}
                    {isActive && !isComp && (
                      <div style={{ marginBottom:22 }}>
                        {/* Primary — label adapts to state. Cancelling subs
                            see "Reactivar" (the most relevant action they
                            could take); past-due see "Actualizar método de
                            pago" (the urgent one); renewing see the generic
                            "Administrar". All routes go to the same Stripe
                            Billing Portal — Stripe surfaces the right
                            in-portal flow based on sub state. */}
                        <button type="button" className="btn btn-primary"
                          onClick={handleOpenPortal} disabled={subBusy}>
                          {subBusy ? t("loading")
                            : summary.primaryCta
                              ? t(summary.primaryCta)
                              : t("subscription.managePortalCta")}
                        </button>
                        <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginTop:8, lineHeight:1.4 }}>
                          {t("subscription.portalFooter")}
                        </div>
                        {/* Pause-subscription link — only when the sub is
                            actively renewing. Hidden for cancelling subs
                            (they're already winding down — pause is
                            redundant + confusing) and past_due (urgency
                            should be on fixing payment). */}
                        {summary.secondaryCta === "subscription.pauseCta" && (
                          <>
                            <button type="button" className="btn btn-ghost"
                              onClick={handleOpenPortal} disabled={subBusy}
                              style={{ width:"100%", marginTop:10, fontSize:13 }}>
                              {t("subscription.pauseCta")}
                            </button>
                            <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginTop:4, lineHeight:1.4 }}>
                              {t("subscription.pauseHint")}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Value-realization widget — only for active subs that have
                        enough historic data. The helper short-circuits to null
                        below the threshold, so the widget self-hides for
                        brand-new accounts without ceremony. */}
                    {isActive && !isComp && <ProValueWidget />}

                    {/* Invoice history — last 6 paid invoices, populated by the
                        webhook on each invoice.paid. Empty for accounts that
                        predate the stripe_invoices table; the Stripe portal
                        link in the next-charge widget covers historical
                        receipts for those users. */}
                    {isActive && !isComp && Array.isArray(s.invoices) && s.invoices.length > 0 && (
                      <div style={{ marginBottom:14 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
                          {t("subscription.invoiceHistoryTitle")}
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                          {s.invoices.map((inv: Row) => {
                            const date = formatDate(inv.paid_at, "shortYear");
                            const amount = `${formatMXNCents(inv.amount_cents)}`;
                            const link = inv.hosted_invoice_url || inv.pdf_url;
                            return (
                              <a key={inv.id}
                                href={link || "#"}
                                target={link ? "_blank" : undefined}
                                rel={link ? "noopener noreferrer" : undefined}
                                onClick={(e) => { if (!link) e.preventDefault(); }}
                                style={{
                                  display:"flex", alignItems:"center", justifyContent:"space-between",
                                  padding:"10px 12px",
                                  background:"var(--white)",
                                  border:"1px solid var(--border)",
                                  borderRadius:"var(--radius)",
                                  textDecoration:"none",
                                  color:"var(--charcoal)",
                                  fontSize:13,
                                }}>
                                <span>{date}</span>
                                <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <span style={{ fontWeight:700 }}>{amount}</span>
                                  {link && <span style={{ color:"var(--teal-dark)", fontSize:12 }}>{t("subscription.invoiceView")} →</span>}
                                </span>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Recovery affordance — only relevant when there's a
                        Stripe-side sub to reconcile. Tiny, subtle, lives at
                        the bottom of the sheet so it doesn't compete with
                        the primary actions. The hint is intentionally short
                        — users who don't recognize the situation will scroll
                        past; users with stale state recognize it instantly. */}
                    {isActive && !isComp && (
                      <div style={{ marginTop:24, paddingTop:14, borderTop:"1px solid var(--border-lt)", textAlign:"center" }}>
                        <button type="button"
                          onClick={handleSyncWithStripe} disabled={syncBusy || subBusy}
                          style={{
                            background:"transparent", border:"none",
                            color: syncDone ? "var(--green)" : "var(--charcoal-xl)",
                            fontSize:11, cursor:"pointer", padding:"4px 8px",
                            fontWeight: 500,
                          }}>
                          {syncBusy ? t("subscription.syncing")
                            : syncDone ? `✓ ${t("subscription.syncDone")}`
                            : `↻ ${t("subscription.syncCta")}`}
                        </button>
                      </div>
                    )}

                  </>
                );
              })()}
            </div>
          </div>
        </div>
  );
}
