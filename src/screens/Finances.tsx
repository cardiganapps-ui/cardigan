import { useState, useMemo } from "react";
import { getClientColor } from "../data/seedData";
import { IconCheck, IconUsers, IconPlus, IconDollar } from "../components/Icons";
import { formatMXN } from "../utils/format";
import { useCardiganMain } from "../context/CardiganContext";
import { SegmentedControl } from "../components/SegmentedControl";
import { Avatar } from "../components/Avatar";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { useT } from "../i18n/index";
import { clickableProps } from "../utils/a11y";
import { isPotentialOrDiscarded } from "../data/constants";
import { PagosTab } from "./finances/PagosTab";
import { ProyeccionTab } from "./finances/ProyeccionTab";
import { GastosTab } from "./finances/GastosTab";
import { ResumenTab } from "./finances/ResumenTab";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed patient/payment rows
type Row = any;

export function Finances() {
  // `deletePayment` is already wrapped at the context level to surface
  // a success toast, so we use it directly here.
  const {
    patients, payments, upcomingSessions,
    openRecordPaymentModal, openEditPaymentModal, deletePayment,
    expenses, recurringExpenses,
    openRecordExpenseModal, openEditExpenseModal, openRecurringExpenseSheet,
    deleteExpense, generatePendingRecurringExpenses,
    mutating, openExpediente, requestFabAction, readOnly,
  } = useCardiganMain();
  const { t } = useT();
  const [tab, setTab] = useState("balances");
  const [balanceFilter, setBalanceFilter] = useState<string | null>(null); // null | "owing" | "paid"
  // Balances and the Por-cobrar / Al-corriente lists belong to the
  // active-patient lane only. Potentials with a past-1h scheduled
  // interview auto-complete and otherwise inflate "Outstanding" before
  // the practitioner has decided to convert them. Surfacing them in
  // the Potenciales view is the right place; here they're noise.
  const regularPatients = useMemo(
    () => patients.filter((p: Row) => !isPotentialOrDiscarded(p)),
    [patients]
  );
  const totalOwed     = regularPatients.reduce((s: number, p: Row) => s+p.amountDue, 0);
  const owingPatients = regularPatients.filter((p: Row) => p.amountDue>0);
  const noPatients    = regularPatients.length === 0;

  return (
    <div className="page">
      <div style={{ padding:"16px 16px 16px" }}>
        <SegmentedControl
          value={tab}
          onChange={setTab}
          items={[
            { k: "balances", l: t("finances.balances") },
            { k: "pagos",    l: t("finances.payments") },
            { k: "gastos",   l: t("finances.expenses") },
            { k: "resumen",  l: t("finances.summary") },
            // Shorter "Proy." instead of "Proyección" so the 5-tab row
            // fits on iPhone SE (360px) without ellipsis — the long
            // label was the only one busting the budget.
            { k: "proyeccion", l: t("finances.forecastShort") },
          ]}
        />
      </div>

      {tab==="balances" && (
        <div>
          <div className="fin-stats-grid">
            <button type="button"
              onClick={() => setBalanceFilter(balanceFilter === "owing" ? null : "owing")}
              className={`stat-tile stat-tile-clickable ${balanceFilter === "owing" ? "stat-tile-selected" : ""}`}>
              <div className="stat-tile-label">{t("finances.outstanding")}</div>
              <div className="stat-tile-val" style={{ color:"var(--red)" }}><AnimatedNumber value={totalOwed} format={formatMXN} /></div>
              <div className="stat-tile-sub">{t("finances.patientCount", { count: owingPatients.length })}</div>
            </button>
            <button type="button"
              onClick={() => setBalanceFilter(balanceFilter === "paid" ? null : "paid")}
              className={`stat-tile stat-tile-clickable ${balanceFilter === "paid" ? "stat-tile-selected" : ""}`}>
              <div className="stat-tile-label">{t("patients.upToDate")}</div>
              <div className="stat-tile-val" style={{ color:"var(--green)" }}><AnimatedNumber value={regularPatients.filter((p: Row)=>p.amountDue<=0).length} /></div>
              <div className="stat-tile-sub">{t("finances.patientsLabel")}</div>
            </button>
          </div>
          {noPatients && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"32px 24px" }}>
              <div style={{ width:56, height:56, background:"var(--teal-pale)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:16, color:"var(--teal)" }}>
                <IconUsers size={26} />
              </div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)", marginBottom:6 }}>{t("patients.noPatients")}</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5, marginBottom:18 }}>{t("patients.addFirst")}</div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => requestFabAction?.("patient")}
                  className="btn btn-primary"
                  style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
                  <IconPlus size={16} /> {t("patients.addFirstCta")}
                </button>
              )}
            </div>
          )}
          {!noPatients && (
          <div className="finances-balances-cols">
          {balanceFilter !== "paid" && (
            <div className="finances-balances-col" style={{ padding:"0 16px 8px" }}>
              <div className="section-title" style={{ marginBottom:10 }}>{t("finances.patientBalance")}</div>
              <div className="card">
                {regularPatients.filter((p: Row)=>p.amountDue>0).sort((a: Row, b: Row)=>b.amountDue-a.amountDue).map((p: Row, i: number) => (
                  <div className="bal-row" key={p.id} style={{ gap:8 }}>
                    <div
                      {...clickableProps(() => openExpediente(p))}
                      style={{ display:"flex", alignItems:"center", gap:12, flex:1, minWidth:0, cursor:"pointer" }}>
                      <Avatar initials={p.initials} color={getClientColor(i)} size="sm" />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div className="bal-name">{p.name}</div>
                      </div>
                      <div className="bal-amt amount-owe">{formatMXN(p.amountDue)}</div>
                    </div>
                    <button type="button"
                      aria-label={t("finances.recordPayment")}
                      onClick={(e) => { e.stopPropagation(); openRecordPaymentModal(p); }}
                      style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", border:"none", cursor:"pointer", flexShrink:0, WebkitTapHighlightColor:"transparent", padding:0 }}>
                      <IconDollar size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {balanceFilter !== "owing" && (
            <div className="finances-balances-col" style={{ padding: balanceFilter === "paid" ? "0 16px 8px" : "16px 16px 0" }}>
              <div className="section-title" style={{ marginBottom:10 }}>{t("patients.upToDate")}</div>
              <div className="card">
                {regularPatients.filter((p: Row)=>p.amountDue<=0).map((p: Row, i: number) => (
                  <div className="bal-row" key={p.id} {...clickableProps(() => openExpediente(p))}
                    style={{ cursor:"pointer" }}>
                    <Avatar initials={p.initials} color={getClientColor(i + 4)} size="sm" />
                    <div style={{ flex:1 }}>
                      <div className="bal-name">{p.name}</div>
                      <div className="bal-sub">{formatMXN(p.paid)} {t("finances.paidAmount")}</div>
                    </div>
                    {p.credit > 0 ? (
                      // Prepaid patients still live in the "Al
                      // corriente" bucket but get a green pill showing
                      // how much they've paid ahead — otherwise there's
                      // no visible distinction from someone who paid
                      // exactly what they owed.
                      <span className="badge badge-green" style={{ fontSize: 11, fontWeight: 700 }}>
                        +{formatMXN(p.credit)} {t("finances.creditShort")}
                      </span>
                    ) : (
                      <div className="bal-amt amount-paid"><IconCheck size={16} /></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
          )}
        </div>
      )}

      {tab==="pagos" && <PagosTab payments={payments} patients={patients} onRecordPayment={openRecordPaymentModal} onEditPayment={openEditPaymentModal} onDeletePayment={deletePayment} mutating={mutating} onAddFirstPatient={() => requestFabAction?.("patient")} />}

      {tab==="gastos" && (
        <GastosTab
          expenses={expenses || []}
          recurringExpenses={recurringExpenses || []}
          onRecord={openRecordExpenseModal}
          onEdit={openEditExpenseModal}
          onDelete={deleteExpense}
          generatePending={generatePendingRecurringExpenses}
          onManageRecurring={openRecurringExpenseSheet}
          mutating={mutating}
        />
      )}

      {tab==="resumen" && (
        <ResumenTab
          payments={payments || []}
          expenses={expenses || []}
          patients={patients || []}
          upcomingSessions={upcomingSessions || []}
        />
      )}

      {tab==="proyeccion" && <ProyeccionTab sessions={upcomingSessions} patients={patients} />}

    </div>
  );
}
