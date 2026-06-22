import { memo } from "react";
import { useT } from "../../../i18n/index";
import { formatMXN } from "../../../utils/format";
import { IconDollar, IconCheck, IconCreditCard } from "../../../components/Icons";
import { AnimatedNumber } from "../../../components/AnimatedNumber";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed profession-theme row
type Row = any;

export const BalanceCard = memo(function BalanceCard({ amountDue, credit, rate, paid, onPay, theme }: {
  amountDue: number;
  credit: number;
  rate?: number;
  paid?: number;
  onPay?: () => void;
  theme?: Row;
}) {
  const { t } = useT();
  // Three states. Mutually exclusive by construction (the
  // accounting helper only ever sets one of amountDue / credit
  // to non-zero).
  const owes = amountDue > 0;
  const hasCredit = credit > 0;
  const tone = owes ? "owe" : hasCredit ? "credit" : "even";
  const palette = {
    owe:    { bg: "var(--red-bg)",   fg: "var(--red)",   bar: "var(--red)" },
    credit: { bg: "var(--green-bg)", fg: "var(--green)", bar: "var(--green)" },
    even:   { bg: theme?.accentPale || "var(--teal-pale)", fg: theme?.accentDark || "var(--teal-dark)", bar: theme?.accent || "var(--teal)" },
  }[tone];
  const Icon = tone === "even" ? IconCheck : IconDollar;

  // Count-up the money figures (mirrors the therapist KPIs). On a
  // post-payment refresh the balance counts DOWN old→new; on mount it
  // reveals 0→value. The "even" branch stays a plain string. 500ms
  // settles in concert with the progress bar below (--dur-base).
  const valueText = owes
    ? <AnimatedNumber value={amountDue} format={formatMXN} duration={500} />
    : hasCredit
      ? <AnimatedNumber value={credit} format={formatMXN} duration={500} />
      : t("patientHome.balanceEvenValue");

  const label = owes
    ? t("patientHome.balanceOwe")
    : hasCredit
      ? t("patientHome.balanceCredit")
      : t("patientHome.balanceEven");

  // Progress visualization — only shown when there's history to
  // visualize. Total = paid + amountDue (the accumulated cost so
  // far). Bar shows the paid fraction filled in green/teal, with
  // the unpaid remainder in red. Reads as "this is how much of
  // your relationship is settled" rather than just an abstract
  // peso amount.
  const totalConsumed = (paid || 0) + (amountDue || 0);
  const showBar = totalConsumed > 0 && (owes || (paid || 0) > 0);
  const paidPct = totalConsumed > 0 ? Math.round(((paid || 0) / totalConsumed) * 100) : 0;

  return (
    <div className="card list-entry-stagger" style={{ padding: 16, background: "var(--white)", "--stagger-i": 4 } as React.CSSProperties}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--charcoal-xl)",
          marginBottom: 10,
        }}
      >
        {t("patientHome.balanceLabel")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: palette.bg,
            color: palette.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <Icon size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 24,
              color: palette.fg,
              letterSpacing: "-0.4px",
              lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {valueText}
          </div>
          <div style={{ fontSize: 13, color: "var(--charcoal-md)", marginTop: 2 }}>
            {label}
          </div>
        </div>
      </div>
      {showBar && (
        <div style={{ marginTop: 14 }}>
          {/* Balance paid-progress bar. Track uses --border-lt (the
              modern divider token) instead of legacy --cream-dark;
              fill animates with --dur-base so updates feel snappy
              rather than syrupy. */}
          <div
            style={{
              position: "relative",
              height: 8,
              borderRadius: 100,
              background: "var(--border-lt)",
              overflow: "hidden",
            }}
            aria-hidden="true"
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${paidPct}%`,
                background: "var(--green)",
                borderRadius: 100,
                transition: "width var(--dur-base) var(--ease-spring)",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--charcoal-md)", fontVariantNumeric: "tabular-nums" }}>
            <span>{`Pagado · ${formatMXN(paid || 0)}`}</span>
            {owes && <span style={{ color: "var(--red)", fontWeight: 600 }}>{`Por pagar · ${formatMXN(amountDue)}`}</span>}
          </div>
        </div>
      )}
      {(rate ?? 0) > 0 && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px solid var(--border-lt)",
            fontSize: 12,
            color: "var(--charcoal-xl)",
          }}
        >
          {t("patientHome.ratePerSession", { rate: formatMXN(rate as number) })}
        </div>
      )}
      {onPay && (
        <button
          type="button"
          onClick={onPay}
          className="btn btn-primary"
          style={{
            marginTop: 14,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: theme?.accent || undefined,
          }}
        >
          <IconCreditCard size={14} />
          {t("patientHome.payCta", { amount: formatMXN(amountDue) })}
        </button>
      )}
    </div>
  );
});
