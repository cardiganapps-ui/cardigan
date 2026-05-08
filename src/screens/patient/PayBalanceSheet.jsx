import { useState, useEffect } from "react";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { IconX, IconCreditCard, IconLock } from "../../components/Icons";
import { usePatientPay } from "../../hooks/usePatientPay";
import { formatMXN } from "../../utils/format";

/* ── PayBalanceSheet ──────────────────────────────────────────────
   Patient picks how much to pay (≤ amountDue, ≥ 20 MXN) and we mint
   a Stripe Checkout Session via /api/patient-create-checkout. On
   success, window.location.href flips the browser to Stripe; the
   patient pays, and Stripe redirects them back to /?pago=exito.

   The sheet keeps the form simple: a pre-filled amount input, a
   safety hint ("pagas a {therapist}, no a Cardigan"), and a single
   Continuar button. Stripe handles every other concern (card form,
   3DS, receipts). */

const MIN_AMOUNT = 20; // pesos — server-side floor enforces 20 MXN
const MAX_AMOUNT = 50_000;

export function PayBalanceSheet({ open, onClose, patient, amountDue, therapistName }) {
  const { t } = useT();
  const { showToast, setHideFab } = useCardigan();
  const { pay, busy } = usePatientPay();
  const initialAmount = Math.max(MIN_AMOUNT, Math.min(MAX_AMOUNT, Math.round(Number(amountDue) || 0)));
  const [amount, setAmount] = useState(String(initialAmount));
  // Track when the sheet last opened so we can reset the amount in
  // the adjust-during-render pattern instead of a setState-in-effect.
  // Each open clears the previous amount and seeds the input with
  // the current full balance, while keeping the user's edits stable
  // for the duration of the sheet session.
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setAmount(String(Math.max(MIN_AMOUNT, Math.min(MAX_AMOUNT, Math.round(Number(amountDue) || 0)))));
    }
  }

  useEffect(() => {
    if (!open) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [open, setHideFab]);

  useEscape(open ? onClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: open });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  if (!open || !patient) return null;

  const amountNum = Math.round(Number(amount) || 0);
  const overBalance = amountNum > Math.round(Number(amountDue) || 0);
  const tooSmall = amountNum < MIN_AMOUNT;
  const tooLarge = amountNum > MAX_AMOUNT;
  const valid = !overBalance && !tooSmall && !tooLarge && Number.isFinite(amountNum);

  const submit = async () => {
    if (!valid || busy) return;
    const r = await pay({ patientId: patient.id, amountPesos: amountNum });
    // On ok, the hook has already redirected. On fail, we surface a
    // friendly toast — the most likely reasons (network, therapist
    // disabled Connect mid-flow, amount out of range) all map cleanly.
    if (!r.ok) {
      const msg = r.code === "not_enabled"
        ? t("patientPay.notEnabledError")
        : r.code === "out_of_range"
          ? t("patientPay.amountError")
          : t("patientPay.genericError");
      showToast(msg, "error");
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("patientPay.title")}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
        style={{ maxHeight: "90vh" }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("patientPay.title")}</span>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label={t("close")}
          >
            <IconX size={14} />
          </button>
        </div>

        <div style={{ padding: "0 20px 24px" }}>
          {/* Intro — who you're paying, balance reminder */}
          <div
            style={{
              fontSize: "var(--text-md)",
              color: "var(--charcoal)",
              lineHeight: 1.55,
              marginBottom: 14,
            }}
          >
            {t("patientPay.intro", { name: therapistName || t("patientClaim.therapistFallback") })}
          </div>

          {/* Balance reference card */}
          <div
            className="card"
            style={{
              padding: "12px 14px",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--cream)",
            }}
          >
            <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)" }}>
              {t("patientPay.balanceLabel")}
            </div>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 700, color: "var(--charcoal)" }}>
              {formatMXN(Math.round(Number(amountDue) || 0))}
            </div>
          </div>

          {/* Amount input */}
          <div className="input-group" style={{ marginBottom: 6 }}>
            <label className="input-label">{t("patientPay.amountLabel")}</label>
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "var(--text-md)",
                  color: "var(--charcoal-md)",
                  fontWeight: 700,
                  pointerEvents: "none",
                }}
              >
                $
              </span>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={MIN_AMOUNT}
                max={Math.min(MAX_AMOUNT, Math.round(Number(amountDue) || MAX_AMOUNT))}
                step="1"
                style={{ paddingLeft: 28, fontSize: "var(--text-md)", fontWeight: 700 }}
                autoFocus
              />
            </div>
          </div>
          {/* Validation hint — narrow and discreet, only when needed */}
          {(tooSmall || overBalance || tooLarge) && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--red, #b3261e)", marginBottom: 12 }}>
              {tooSmall && t("patientPay.minAmountHint", { min: formatMXN(MIN_AMOUNT) })}
              {!tooSmall && overBalance && t("patientPay.overBalanceHint")}
              {!tooSmall && !overBalance && tooLarge && t("patientPay.maxAmountHint", { max: formatMXN(MAX_AMOUNT) })}
            </div>
          )}

          {/* Trust footnote — funds go directly to therapist, Stripe-secured */}
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: "10px 12px",
              borderRadius: "var(--radius)",
              background: "var(--teal-pale)",
              fontSize: "var(--text-xs)",
              color: "var(--teal-dark)",
              lineHeight: 1.55,
              margin: "12px 0 18px",
            }}
          >
            <IconLock size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{t("patientPay.trustNote")}</span>
          </div>

          {/* Submit */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={!valid || busy}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: !valid || busy ? 0.6 : 1,
            }}
          >
            <IconCreditCard size={14} />
            {busy
              ? t("patientPay.busy")
              : t("patientPay.continueCta", { amount: formatMXN(amountNum || 0) })}
          </button>
        </div>
      </div>
    </div>
  );
}
