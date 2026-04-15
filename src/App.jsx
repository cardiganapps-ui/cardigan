import { useEffect, useState, useRef, useCallback, useMemo } from "react";
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
import { LogoIcon } from "./components/LogoMark";
import { InstallPrompt } from "./components/InstallPrompt";
import { HelpTip } from "./components/HelpTip";
import { IconRefresh } from "./components/Icons";
import { Tutorial } from "./components/Tutorial/Tutorial";
import { useTutorial } from "./hooks/useTutorial";
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
import { BugReportFab } from "./components/BugReportFab";
import { useTheme } from "./hooks/useTheme";
import "./utils/logBuffer";
import "./styles.css";

function CardiganApp() {
  const { user, loading: authLoading, signUp, signIn, signOut } = useAuth();
  const [demoMode, setDemoMode] = useState(false);
  const theme = useTheme();

  if (authLoading && !demoMode) {
    return (
      <div className="shell" style={{ justifyContent:"center", alignItems:"center", gap:12 }}>
        <LogoIcon size={48} color="var(--teal)" />
        <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.3px" }}>cardigan</div>
      </div>
    );
  }

  if (demoMode) {
    return <AppShell user={null} signOut={() => setDemoMode(false)} demo theme={theme} />;
  }

  if (!user) {
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} onDemo={() => setDemoMode(true)} />;
  }

  return <AppShell user={user} signOut={signOut} theme={theme} />;
}

export default function Cardigan() {
  return <I18nProvider><CardiganApp /></I18nProvider>;
}

function AppShell({ user, signOut, demo, theme }) {
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
  const [editingPayment, setEditingPayment] = useState(null);
  const [successMsg, setSuccessMsg] = useState("");
  const pendingAgendaViewRef = useRef(null);

  const tutorial = useTutorial({ user, demo, readOnly });

  const userName = demo ? "Demo" : (user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario");
  const userInitial = userName.charAt(0).toUpperCase();

  const openEditPaymentModal = (payment) => {
    if (readOnly) return;
    setEditingPayment(payment);
    setPaymentDraft({ patientName: "", amount: "" });
    setPaymentModalOpen(true);
  };

  const openRecordPaymentModal = (patient) => {
    if (readOnly) return;
    setEditingPayment(null);
    setPaymentDraft({
      patientName: patient?.name || "",
      amount: patient ? String(patient.amountDue || 0) : "",
    });
    setPaymentModalOpen(true);
  };

  /* ── Edge swipe to open drawer ──
     These handlers are attached via a native addEventListener with
     `passive: false` so that once we detect an intentional horizontal swipe
     from the left edge we can call e.preventDefault() on the touchmove.
     That prevents iOS Safari's native "edge-swipe-back" gesture from racing
     with our drawer open (the combo the user reported as "the drawer opens
     AND the screen goes back"). React's synthetic touch handlers are always
     passive, so this has to go through addEventListener directly. */
  const shellRef = useRef(null);
  const edgeRef = useRef(null);
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;
  const [swipeProgress, setSwipeProgress] = useState(0);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const onTouchStart = (e) => {
      if (drawerOpenRef.current) return;
      if (e.touches[0].clientX < 20) {
        edgeRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          time: Date.now(),
          active: false,
        };
      } else {
        edgeRef.current = null;
      }
    };

    const onTouchMove = (e) => {
      if (!edgeRef.current || drawerOpenRef.current) return;
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
        // Suppress iOS Safari's native back-peek while the user is dragging
        // the drawer in. This is the key to resolving the drawer-vs-back
        // conflict on non-standalone mobile browsers.
        if (e.cancelable) e.preventDefault();
        setSwipeProgress(Math.max(0, dx));
      }
    };

    const onTouchEnd = (e) => {
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
    };

    shell.addEventListener("touchstart", onTouchStart, { passive: true });
    shell.addEventListener("touchmove", onTouchMove, { passive: false });
    shell.addEventListener("touchend", onTouchEnd, { passive: true });
    shell.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      shell.removeEventListener("touchstart", onTouchStart);
      shell.removeEventListener("touchmove", onTouchMove);
      shell.removeEventListener("touchend", onTouchEnd);
      shell.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const ctxValue = useMemo(() => ({
    ...data, userName, userInitial, openRecordPaymentModal, openEditPaymentModal, setHideFab, setScreen,
    navigate, pushLayer, popLayer, removeLayer,
    screen, drawerOpen, tutorial, theme, showSuccess: setSuccessMsg,
    setAgendaView: (v) => { pendingAgendaViewRef.current = v; },
    consumeAgendaView: () => { const v = pendingAgendaViewRef.current; pendingAgendaViewRef.current = null; return v; },
    onCancelSession: async (s, charge, reason) => !readOnly && await updateSessionStatus(s.id, "cancelled", charge, reason),
    onMarkCompleted: async (s, overrideStatus) => !readOnly && await updateSessionStatus(s.id, overrideStatus || "completed"),
  }), [data, userName, userInitial, readOnly, updateSessionStatus, navigate, pushLayer, popLayer, removeLayer, screen, drawerOpen, tutorial, theme, setSuccessMsg]);

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
    <div className="shell" ref={shellRef}>
      <Drawer screen={screen} setScreen={setScreen} onClose={() => setDrawerOpen(false)}
        user={user} signOut={signOut} open={drawerOpen} swipeProgress={swipeProgress} />

      <div className="main-content">
        <div className="status-bar" />

        {/* Demo banner */}
        {demo && (
          <div style={{ background:"#3A7A8A", padding:"8px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:"var(--z-banner)", flexShrink:0 }}>
            <span style={{ fontSize:11, fontWeight:600, color:"#FFFFFF" }}>{t("demo.banner")}</span>
            <button onClick={signOut}
              style={{ fontSize:11, fontWeight:700, color:"#FFFFFF", background:"rgba(255,255,255,0.2)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", padding:"4px 12px" }}>
              {t("demo.createAccount")}
            </button>
          </div>
        )}

        {/* Read-only banner when viewing as another user */}
        {readOnly && !demo && (
          <div style={{ background:"#2E2E2E", padding:"8px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:"var(--z-banner)", flexShrink:0 }}>
            <span style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.7)" }}>{t("admin.readOnly")}</span>
            <button onClick={() => { setViewAsUserId(null); setScreen("home"); }}
              style={{ fontSize:11, fontWeight:700, color:"#6DB8CC", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", padding:"2px 8px" }}>
              {t("admin.exit")}
            </button>
          </div>
        )}

        <div className="topbar">
          <button className={`hamburger ${drawerOpen?"open":""}`} data-tour="hamburger" onClick={() => setDrawerOpen(o=>!o)} aria-label="Menú">
            <div className="hamburger-line" />
            <div className="hamburger-line" />
            <div className="hamburger-line" />
          </button>
          <div className="topbar-brand" onClick={() => navigate("home")} style={{ cursor:"pointer" }}><LogoIcon size={20} color="currentColor" /><span>cardigan</span></div>
          <span className="topbar-screen-name">{t(`nav.${screen}`)}</span>
          <div className="topbar-right">
            <button className="topbar-refresh-btn" onClick={refresh} aria-label="Refresh"><IconRefresh size={16} /></button>
            {admin && !readOnly && (
              <button className="admin-btn" onClick={() => setShowAdmin(true)}>
                Admin
              </button>
            )}
            {/* Contextual help for the current screen. Lives in the topbar
                so it doesn't eat vertical space on each page. HelpTip
                returns null when the screen's tip array is empty. */}
            <HelpTip tipsKey={`help.${screen}`} />
            <div className="avatar-sm" onClick={() => navigate("settings")} style={{ cursor:"pointer" }}>{userInitial}</div>
          </div>
        </div>
        {loading && (
          <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--charcoal-xl)" }}>{t("loading")}</div>
        )}
        <Toast message={mutationError} type="error" />
        <Toast message={successMsg} type="success" onDismiss={() => setSuccessMsg("")} />
        <PullToRefresh onRefresh={refresh}>
          <div style={{
            flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
            transition: direction ? "none" : undefined,
            animation: direction === "left" ? "screenSlideLeft 0.25s cubic-bezier(0.32, 0.72, 0, 1)" :
                       direction === "right" ? "screenSlideRight 0.25s cubic-bezier(0.32, 0.72, 0, 1)" : undefined,
          }}>
            {screenMap[screen]}
          </div>
        </PullToRefresh>
        {!readOnly && (
          <PaymentModal open={paymentModalOpen} onClose={(msg) => { setPaymentModalOpen(false); setEditingPayment(null); if (typeof msg === "string" && msg) setSuccessMsg(msg); }}
            initialPatientName={paymentDraft.patientName} initialAmount={paymentDraft.amount} editingPayment={editingPayment} />
        )}
        {!readOnly && !hideFab && <QuickActions />}

        {showAdmin && (
          <AdminPanel
            onViewAs={(uid) => { setViewAsUserId(uid); setShowAdmin(false); setScreen("home"); }}
            onClose={() => setShowAdmin(false)}
            currentAdminId={user?.id}
          />
        )}
        <InstallPrompt />
        <BugReportFab user={user} screen={screen} />
        {!demo && !readOnly && <Tutorial />}
      </div>
    </div>
    </CardiganProvider>
  );
}
