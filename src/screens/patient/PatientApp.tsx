import React from "react";
import { I18nProvider, useT } from "../../i18n/index";
import { CardiganProvider } from "../../context/CardiganContext";
import type { CardiganContextValue } from "../../context/CardiganContext";
import { Toast } from "../../components/Toast";
import { useEffect, useState, useCallback, useRef } from "react";
import { LogoIcon } from "../../components/LogoMark";
import { usePatientPortalData } from "../../hooks/usePatientPortalData";
import { getDemoPatientPortalSnapshot } from "../../hooks/useDemoPatientPortalData";
import { PatientShell } from "./PatientShell";

/* Sync the I18nProvider's `profession` with the linked therapist's
   profession so the vocabulary engine resolves field-noun labels
   ("psicología", "nutrición") consistently across the patient
   shell. setProfession is only available inside the provider, so
   this lives as a child component. */
function PatientI18nSync({ profession, children }: { profession?: string; children: React.ReactNode }) {
  const i18n = useT();
  const setProfession = i18n.setProfession;
  useEffect(() => {
    if (profession && setProfession) setProfession(profession);
  }, [profession, setProfession]);
  return children;
}

/* ── PatientApp ───────────────────────────────────────────────────
   Patient-side root. Mounts the data hook, builds a minimal
   CardiganContext value (so shared components like ConfirmDialog
   that read from useCardigan() work without rebuilding their
   surface area), and renders PatientShell.

   Deliberately does NOT use the therapist-side useCardiganData /
   AppShell — those carry write actions, profession-driven
   vocabulary, demo logic, admin "view as user" branches, etc.,
   none of which apply to a read-only patient surface.

   The vocabulary engine is fed the THERAPIST'S profession (read
   from the data hook's primary therapist) so the patient-side
   labels resolve to the right field nouns ("psicología",
   "nutrición") for the linked professional. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase auth user + loosely-typed portal data
type Row = any;

type PatientAppProps = {
  user: Row;
  signOut?: () => void;
  demo?: boolean;
};

export function PatientApp({ user, signOut, demo = false }: PatientAppProps) {
  // Demo branch: read-only fixture data, no network. The shape is
  // kept in lockstep with usePatientPortalData by sharing the same
  // generateDemoData() seed the therapist demo uses. Only the e2e
  // patient-portal smoke test sets demo via App.jsx's testMode +
  // demoRole hatch; production never hits it.
  //
  // The real hook is called unconditionally (Rules of Hooks) — it
  // no-ops on null user. The demo snapshot is a plain function call
  // gated by the `demo` prop, so real users never pay the cost of
  // generating the fixture data they'd never see.
  const realData = usePatientPortalData(demo ? null : user);
  const data: Row = demo ? getDemoPatientPortalSnapshot() : realData;
  const [toasts, setToasts] = useState<Array<{ id: number; kind: string; message: string }>>([]);
  const nextToastIdRef = useRef(0);

  // Minimal toast surface — same shape as the therapist app's so
  // shared components that call showToast just work. No persistent
  // / actionable toasts in v1.
  const showToast = useCallback((msg: string, type = "info") => {
    if (!msg) return;
    const id = ++nextToastIdRef.current;
    setToasts(prev => [...prev, { id, kind: type, message: msg }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const ctxValue = {
    user,
    showToast,
    showSuccess: (msg: string) => showToast(msg, "success"),
    readOnly: true,
    setHideFab: () => {}, // patient shell has no FAB; sheets that toggle it no-op
    profession: data.primaryTherapist?.therapist_profession || "psychologist",
  };

  if (data.loading && !data.primaryPatient) {
    return (
      <div style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--white)",
        gap: 12,
        flexDirection: "column",
      }}>
        <span className="cardigan-splash-logo" aria-hidden="true">
          <LogoIcon size={48} color="var(--teal)" />
        </span>
      </div>
    );
  }

  return (
    <I18nProvider>
      <PatientI18nSync profession={ctxValue.profession}>
      {/* The patient portal provides only the handful of context fields its
          read-only shell reads (no therapist data/mutations), so it's a
          deliberate subset of the full CardiganContextValue. */}
      <CardiganProvider value={ctxValue as unknown as CardiganContextValue}>
        <PatientShell user={user} signOut={signOut} data={data} />
        {toasts.length > 0 && (
          <div style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top) + 16px)",
            left: 0,
            right: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "center",
            pointerEvents: "none",
            zIndex: 1000,
          }}>
            {toasts.map(toast => (
              <Toast
                key={toast.id}
                type={toast.kind}
                message={toast.message}
                onDismiss={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              />
            ))}
          </div>
        )}
      </CardiganProvider>
      </PatientI18nSync>
    </I18nProvider>
  );
}
