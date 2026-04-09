import { useState, useRef, useCallback } from "react";
import { useAuth } from "./hooks/useAuth";
import { useCardiganData } from "./hooks/useCardiganData";
import { Drawer } from "./components/Drawer";
import { PaymentModal } from "./components/PaymentModal";
import { QuickActions } from "./components/QuickActions";
import { IconHome } from "./components/Icons";
import { Home } from "./screens/Home";
import { Agenda } from "./screens/Agenda";
import { Patients } from "./screens/Patients";
import { Finances } from "./screens/Finances";
import { Settings } from "./screens/Settings";
import { AuthScreen } from "./screens/AuthScreen";
import "./styles.css";

export default function Cardigan() {
  const { user, loading: authLoading, signUp, signIn, signOut } = useAuth();

  if (authLoading) {
    return (
      <div className="shell" style={{ justifyContent:"center", alignItems:"center" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize:20, fontWeight:800, color:"var(--charcoal-xl)" }}>cardigan</div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} />;
  }

  return <AppShell user={user} signOut={signOut} />;
}

function AppShell({ user, signOut }) {
  const [screen, setScreen] = useState("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const data = useCardiganData(user);
  const {
    patients, upcomingSessions, payments,
    loading, mutating, mutationError,
    createPayment, createPatient, createSession,
    updateSessionStatus, updatePatient, deletePatient,
    deleteSession, rescheduleSession, deletePayment, generateRecurringSessions, applyScheduleChange,
  } = data;
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({ patientName:"", amount:"" });

  const userName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Usuario";
  const userInitial = userName.charAt(0).toUpperCase();

  const openRecordPaymentModal = (patient) => {
    setPaymentDraft({
      patientName: patient?.name || "",
      amount: patient ? String(patient.amountDue || 0) : "",
    });
    setPaymentModalOpen(true);
  };

  /* ── Edge swipe to open drawer ── */
  const edgeRef = useRef(null);
  const [swipeX, setSwipeX] = useState(null);

  const onTouchStart = useCallback((e) => {
    if (drawerOpen) return;
    if (e.touches[0].clientX < 24) {
      edgeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, active: false };
    } else {
      edgeRef.current = null;
    }
  }, [drawerOpen]);

  const onTouchMove = useCallback((e) => {
    if (!edgeRef.current || drawerOpen) return;
    const dx = e.touches[0].clientX - edgeRef.current.startX;
    const dy = e.touches[0].clientY - edgeRef.current.startY;
    if (!edgeRef.current.active) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        edgeRef.current.active = true;
      } else if (Math.abs(dy) > 10) {
        edgeRef.current = null;
        return;
      } else {
        return;
      }
    }
    if (edgeRef.current.active) {
      setSwipeX(Math.max(0, e.touches[0].clientX));
    }
  }, [drawerOpen]);

  const onTouchEnd = useCallback((e) => {
    if (!edgeRef.current?.active) {
      edgeRef.current = null;
      return;
    }
    const finalX = e.changedTouches[0].clientX;
    edgeRef.current = null;
    setSwipeX(null);
    if (finalX > 120) setDrawerOpen(true);
  }, []);

  const screenMap = {
    home: <Home setScreen={setScreen} patients={patients} upcomingSessions={upcomingSessions} payments={payments} onRecordPayment={openRecordPaymentModal} mutating={mutating} userName={userName} />,
    agenda: <Agenda upcomingSessions={upcomingSessions} patients={patients}
      onCancelSession={async (s, charge) => s?.status === "scheduled" && await updateSessionStatus(s.id, "cancelled", charge)}
      deleteSession={deleteSession} rescheduleSession={rescheduleSession} mutating={mutating} />,
    patients: <Patients patients={patients} upcomingSessions={upcomingSessions} onRecordPayment={openRecordPaymentModal}
      updatePatient={updatePatient} deletePatient={deletePatient} createSession={createSession}
      generateRecurringSessions={generateRecurringSessions} applyScheduleChange={applyScheduleChange} mutating={mutating} />,
    finances: <Finances patients={patients} payments={payments}
      onRecordPayment={openRecordPaymentModal} mutating={mutating} />,
    settings: <Settings user={user} signOut={signOut} />,
  };

  return (
    <div className="shell" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="status-bar" />
      <div className="topbar">
        <button className={`hamburger ${drawerOpen?"open":""}`} onClick={() => setDrawerOpen(o=>!o)} aria-label="Menú">
          <div className="hamburger-line" />
          <div className="hamburger-line" />
          <div className="hamburger-line" />
        </button>
        <div className="topbar-brand">cardigan</div>
        <div className="topbar-right">
          <button className="icon-btn" onClick={() => setScreen("home")} aria-label="Inicio"><IconHome size={18} /></button>
          <div className="avatar-sm">{userInitial}</div>
        </div>
      </div>
      {loading && (
        <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--charcoal-xl)" }}>Cargando datos...</div>
      )}
      {!loading && mutationError && (
        <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--red)" }}>{mutationError}</div>
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
      <QuickActions
        patients={patients}
        onOpenPaymentModal={() => openRecordPaymentModal(null)}
        createPatient={createPatient}
        createSession={createSession}
        mutating={mutating}
      />
      <Drawer screen={screen} setScreen={setScreen} onClose={() => setDrawerOpen(false)}
        user={user} signOut={signOut} open={drawerOpen} swipeX={swipeX} />
    </div>
  );
}
