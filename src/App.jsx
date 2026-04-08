import { useState, useMemo } from "react";
import { useCardiganData } from "./hooks/useCardiganData";
import { buildTopbarMeta } from "./data/seedData";
import { Drawer } from "./components/Drawer";
import { PaymentModal } from "./components/PaymentModal";
import { Home } from "./screens/Home";
import { Agenda } from "./screens/Agenda";
import { Patients } from "./screens/Patients";
import { Finances } from "./screens/Finances";
import { Settings } from "./screens/Settings";
import { AuthScreen } from "./screens/AuthScreen";
import "./styles.css";

export default function Cardigan() {
  const [screen, setScreen]       = useState("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const {
    patients,
    upcomingSessions,
    payments,
    loading,
    error,
    mutating,
    mutationError,
    createPayment,
    updateSessionStatus,
  } = useCardiganData();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({ patientName:"", amount:"" });

  const openRecordPaymentModal = (patient) => {
    setPaymentDraft({
      patientName: patient?.name || "",
      amount: patient ? String(Math.max(0, patient.billed - patient.paid)) : "",
    });
    setPaymentModalOpen(true);
  };

  const handleMarkSessionCompleted = async (session) => {
    if (!session || session.status === "completed") return true;
    return updateSessionStatus(session.id, "completed");
  };

  const handleCancelSession = async (session) => {
    if (!session || session.status === "cancelled") return true;
    return updateSessionStatus(session.id, "cancelled");
  };

  const screenMap = {
    home:     <Home setScreen={setScreen} patients={patients} upcomingSessions={upcomingSessions} payments={payments} onRecordPayment={openRecordPaymentModal} mutating={mutating} />,
    agenda:   <Agenda upcomingSessions={upcomingSessions} patients={patients} onMarkSessionCompleted={handleMarkSessionCompleted} onCancelSession={handleCancelSession} mutating={mutating} />,
    patients: <Patients patients={patients} onRecordPayment={openRecordPaymentModal} mutating={mutating} />,
    finances: <Finances patients={patients} payments={payments} onRecordPayment={openRecordPaymentModal} mutating={mutating} />,
    settings: <Settings />,
  };

  const topbarMeta = useMemo(() => buildTopbarMeta(patients), [patients]);
  const isAuth = screen === "auth";
  const meta   = topbarMeta[screen] || topbarMeta.home;

  return (
    <>
      {isAuth ? <AuthScreen /> : (
        <div className="shell">
          <div className="status-bar" />
          <div className="topbar">
            <div className="topbar-left">
              <button className={`hamburger ${drawerOpen?"open":""}`} onClick={() => setDrawerOpen(o=>!o)} aria-label="Menú">
                <div className="hamburger-line" />
                <div className="hamburger-line" />
                <div className="hamburger-line" />
              </button>
              <div className="topbar-center">
                <div className="topbar-title">{meta.title}</div>
                <div className="topbar-sub">{meta.sub}</div>
              </div>
            </div>
            <div className="topbar-right">
              <button className="icon-btn" onClick={() => setScreen("home")} aria-label="Inicio">🏠</button>
              <div className="avatar-sm">D</div>
            </div>
          </div>
          {loading && (
            <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--charcoal-xl)" }}>
              Cargando datos...
            </div>
          )}
          {!loading && error && (
            <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--amber)" }}>
              No se pudo conectar al API. Mostrando datos locales.
            </div>
          )}
          {!loading && mutationError && (
            <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--red)" }}>
              {mutationError}
            </div>
          )}
          {screenMap[screen]}
          <PaymentModal
            open={paymentModalOpen}
            onClose={() => setPaymentModalOpen(false)}
            patients={patients}
            initialPatientName={paymentDraft.patientName}
            initialAmount={paymentDraft.amount}
            onSubmit={createPayment}
            mutating={mutating}
          />
          <button className="fab" aria-label="Agregar">+</button>
          {drawerOpen && <Drawer screen={screen} setScreen={setScreen} onClose={() => setDrawerOpen(false)} />}
        </div>
      )}
    </>
  );
}
