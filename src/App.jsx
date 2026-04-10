import { useState, useRef, useCallback, useMemo } from "react";
import { useAuth } from "./hooks/useAuth";
import { useCardiganData, isAdmin } from "./hooks/useCardiganData";
import { useDemoData } from "./hooks/useDemoData";
import { useNavigation } from "./hooks/useNavigation";
import { CardiganProvider } from "./context/CardiganContext";
import { I18nProvider, useT } from "./i18n/index";
import { Drawer } from "./components/Drawer";
import { PaymentModal } from "./components/PaymentModal";
import { QuickActions } from "./components/QuickActions";
import { PullToRefresh } from "./components/PullToRefresh";
import { IconHome, IconSettings } from "./components/Icons";
import { LogoIcon } from "./components/LogoMark";
import { InstallPrompt } from "./components/InstallPrompt";
import { Toast } from "./components/Toast";
import { Home } from "./screens/Home";
import { Agenda } from "./screens/Agenda";
import { Patients } from "./screens/Patients";
import { Finances } from "./screens/Finances";
import { Notes } from "./screens/Notes";
import { Documents } from "./screens/Documents";
import { Settings } from "./screens/Settings";
import { AuthScreen } from "./screens/AuthScreen";
import { AdminPanel } from "./screens/AdminPanel";
import "./styles.css";

function CardiganApp() {
  const { user, loading: authLoading, signUp, signIn, signOut } = useAuth();
  const [demoMode, setDemoMode] = useState(false);

  if (authLoading && !demoMode) {
    return (
      <div className="shell" style={{ justifyContent:"center", alignItems:"center", gap:12 }}>
        <LogoIcon size={48} color="var(--teal)" />
        <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.3px" }}>cardigan</div>
      </div>
    );
  }

  if (demoMode) {
    return <AppShell user={null} signOut={() => setDemoMode(false)} demo />;
  }

  if (!user) {
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} onDemo={() => setDemoMode(true)} />;
  }

  return <AppShell user={user} signOut={signOut} />;
}

export default function Cardigan() {
  return <I18nProvider><CardiganApp /></I18nProvider>;
}

function AppShell({ user, signOut, demo }) {
  const { t } = useT();
  const { screen, direction, navigate, pushLayer, popLayer, removeLayer } = useNavigation();
  const setScreen = navigate; // alias for compatibility
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewAsUserId, setViewAsUserId] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [hideFab, setHideFab] = useState(false);
  const admin = !demo && isAdmin(user);

  const liveData = useCardiganData(demo ? null : user, viewAsUserId);
  const demoData = useDemoData();
  const data = demo ? demoData : liveData;
  const {
    patients, upcomingSessions, payments, notes, documents,
    loading, mutating, mutationError, readOnly,
    createPayment, createPatient, createSession,
    updateSessionStatus, updatePatient, deletePatient,
    deleteSession, rescheduleSession, deletePayment,
    generateRecurringSessions, applyScheduleChange, finalizePatient,
    createNote, updateNote, deleteNote,
    uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl,
    refresh,
  } = data;
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({ patientName:"", amount:"" });

  const userName = demo ? "Demo" : (user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario");
  const userInitial = userName.charAt(0).toUpperCase();

  const openRecordPaymentModal = (patient) => {
    if (readOnly) return;
    setPaymentDraft({
      patientName: patient?.name || "",
      amount: patient ? String(patient.amountDue || 0) : "",
    });
    setPaymentModalOpen(true);
  };

  /* ── Edge swipe to open drawer ── */
  const edgeRef = useRef(null);
  const [swipeProgress, setSwipeProgress] = useState(0);

  const onTouchStart = useCallback((e) => {
    if (drawerOpen) return;
    if (e.touches[0].clientX < 20) {
      edgeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, time: Date.now(), active: false };
    } else {
      edgeRef.current = null;
    }
  }, [drawerOpen]);

  const onTouchMove = useCallback((e) => {
    if (!edgeRef.current || drawerOpen) return;
    const dx = e.touches[0].clientX - edgeRef.current.startX;
    const dy = e.touches[0].clientY - edgeRef.current.startY;
    if (!edgeRef.current.active) {
      if (dx > 10 && Math.abs(dx) > Math.abs(dy)) {
        edgeRef.current.active = true;
      } else if (Math.abs(dy) > 10 || dx < -5) {
        edgeRef.current = null;
        return;
      } else return;
    }
    if (edgeRef.current.active) {
      setSwipeProgress(Math.max(0, dx));
    }
  }, [drawerOpen]);

  const onTouchEnd = useCallback((e) => {
    if (!edgeRef.current?.active) {
      edgeRef.current = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - edgeRef.current.startX;
    const elapsed = Date.now() - edgeRef.current.time;
    const velocity = dx / elapsed;
    edgeRef.current = null;
    if (dx > 100 || velocity > 0.3) {
      setDrawerOpen(true);
    }
    setSwipeProgress(0);
  }, []);

  const ctxValue = useMemo(() => ({
    ...data, userName, userInitial, openRecordPaymentModal, setHideFab, setScreen,
    navigate, pushLayer, popLayer, removeLayer,
    onCancelSession: async (s, charge, reason) => !readOnly && await updateSessionStatus(s.id, "cancelled", charge, reason),
    onMarkCompleted: async (s, overrideStatus) => !readOnly && await updateSessionStatus(s.id, overrideStatus || "completed"),
  }), [data, userName, userInitial, readOnly, updateSessionStatus, navigate, pushLayer, popLayer, removeLayer]);

  const screenMap = {
    home: <Home setScreen={setScreen} userName={userName} />,
    agenda: <Agenda />,
    patients: <Patients />,
    finances: <Finances />,
    notes: <Notes />,
    documents: <Documents />,
    settings: <Settings user={user} signOut={signOut} />,
  };

  return (
    <CardiganProvider value={ctxValue}>
    <div className="shell" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="status-bar" />

      {/* Demo banner */}
      {demo && (
        <div style={{ background:"var(--teal-dark)", padding:"8px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:"var(--z-banner)" }}>
          <span style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.85)" }}>{t("demo.banner")}</span>
          <button onClick={signOut}
            style={{ fontSize:11, fontWeight:700, color:"white", background:"rgba(255,255,255,0.2)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", padding:"4px 12px" }}>
            {t("demo.createAccount")}
          </button>
        </div>
      )}

      {/* Read-only banner when viewing as another user */}
      {readOnly && !demo && (
        <div style={{ background:"var(--charcoal)", padding:"8px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:"var(--z-banner)" }}>
          <span style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.7)" }}>{t("admin.readOnly")}</span>
          <button onClick={() => { setViewAsUserId(null); setScreen("home"); }}
            style={{ fontSize:11, fontWeight:700, color:"var(--teal-light)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", padding:"2px 8px" }}>
            {t("admin.exit")}
          </button>
        </div>
      )}

      <div className="topbar">
        <button className={`hamburger ${drawerOpen?"open":""}`} onClick={() => setDrawerOpen(o=>!o)} aria-label="Menú">
          <div className="hamburger-line" />
          <div className="hamburger-line" />
          <div className="hamburger-line" />
        </button>
        <div className="topbar-brand"><LogoIcon size={20} color="white" /><span>cardigan</span></div>
        <div className="topbar-right">
          {admin && !readOnly && (
            <button className="icon-btn" onClick={() => setShowAdmin(true)} aria-label="Admin"
              style={{ fontSize:10, fontWeight:800, color:"var(--charcoal-xl)", letterSpacing:"0.05em" }}>
              <IconSettings size={16} />
            </button>
          )}
          <button className="icon-btn" onClick={() => setScreen("home")} aria-label="Inicio"><IconHome size={18} /></button>
          <div className="avatar-sm">{userInitial}</div>
        </div>
      </div>
      {loading && (
        <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--charcoal-xl)" }}>{t("loading")}</div>
      )}
      <Toast message={mutationError} type="error" />
      <PullToRefresh onRefresh={refresh}>
        {screenMap[screen]}
      </PullToRefresh>
      {!readOnly && (
        <PaymentModal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)}
          initialPatientName={paymentDraft.patientName} initialAmount={paymentDraft.amount} />
      )}
      {!readOnly && !hideFab && <QuickActions />}
      <Drawer screen={screen} setScreen={setScreen} onClose={() => setDrawerOpen(false)}
        user={user} signOut={signOut} open={drawerOpen} swipeProgress={swipeProgress} />

      {showAdmin && (
        <AdminPanel
          onViewAs={(uid) => { setViewAsUserId(uid); setShowAdmin(false); setScreen("home"); }}
          onClose={() => setShowAdmin(false)}
        />
      )}
      <InstallPrompt />
    </div>
    </CardiganProvider>
  );
}
