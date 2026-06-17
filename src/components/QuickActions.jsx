import { useEffect, useState } from "react";
import { IconUserPlus, IconDollar, IconCalendarPlus, IconClipboard, IconDocument, IconPlus, IconArrowDown, IconUsers } from "./Icons";
import { NewPatientSheet } from "./sheets/NewPatientSheet";
import { NewGroupSheet } from "./sheets/NewGroupSheet";
import { NewSessionSheet } from "./sheets/NewSessionSheet";
import { NewDocumentSheet } from "./sheets/NewDocumentSheet";
import { NoteEditor } from "./NoteEditor";
import { QuickCaptureSheet } from "./notes/QuickCaptureSheet";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";

/* Shared quick-action list. Reused by the desktop "+ Nuevo" top-bar
   button (TopbarActions) so the menu stays in sync with the mobile FAB. */
// eslint-disable-next-line react-refresh/only-export-components
export const QUICK_ACTIONS = [
  { key:"payment",  Icon: IconDollar,       tKey:"fab.payment" },
  { key:"expense",  Icon: IconArrowDown,    tKey:"fab.expense" },
  { key:"patient",  Icon: IconUserPlus,     tKey:"fab.patient" },
  { key:"group",    Icon: IconUsers,        tKey:"fab.group" },
  { key:"note",     Icon: IconClipboard,    tKey:"fab.note" },
  { key:"document", Icon: IconDocument,     tKey:"fab.document" },
  { key:"session",  Icon: IconCalendarPlus, tKey:"fab.session" },
];
const ACTIONS = QUICK_ACTIONS;

export function QuickActions() {
  const { t } = useT();
  const { patients, upcomingSessions, openRecordPaymentModal, openRecordExpenseModal, createPatient, createPotential, createSession, updateNote, deleteNote, uploadDocument, mutating, pendingFabAction, consumeFabAction, subscription, requirePro, groupsEnabled } = useCardigan();
  const isPro = !!subscription?.isPro;
  const actions = ACTIONS.filter(a => a.key !== "group" || groupsEnabled !== false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState(null);
  const [quickNote, setQuickNote] = useState(null);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);

  const handleAction = async (key) => {
    setMenuOpen(false);
    // Document upload is Pro-gated. Intercept here so non-Pro users
    // tapping the FAB option get the upgrade prompt instead of the
    // upload sheet — same gate the Documents screen enforces.
    if (key === "document" && !isPro) {
      requirePro?.("documents");
      return;
    }
    if (key === "payment") openRecordPaymentModal(null);
    else if (key === "expense") openRecordExpenseModal();
    else if (key === "note") {
      // Open the QuickCaptureSheet — the lightweight "jot now,
      // file later" path. From the sheet the user can escalate to
      // the full editor with one tap if they want markdown / tags
      // / linking. Discarding the sheet without typing writes no
      // row, so the FAB tap is now zero-cost.
      setQuickCaptureOpen(true);
    }
    else setActiveSheet(key);
  };

  // Allow other screens (e.g. the empty-state CTA on Home) to open a
  // specific FAB sheet by setting pendingFabAction in context.
  useEffect(() => {
    if (!pendingFabAction) return;
    handleAction(pendingFabAction);
    consumeFabAction?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFabAction]);

  const closeSheet = () => setActiveSheet(null);

  return (
    <>
      {menuOpen && <div className="fab-overlay" onClick={() => setMenuOpen(false)} />}
      {menuOpen && (
        <div className="fab-menu">
          {actions.map((a, i) => (
            <button key={a.key} className="fab-action" style={{ animationDelay:`${i * 0.08}s` }} onClick={() => handleAction(a.key)}>
              <span className="fab-action-label">{t(a.tKey)}</span>
              <span className="fab-action-icon"><a.Icon size={16} /></span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`fab ${menuOpen ? "fab-open" : ""}`}
        onClick={() => { haptic.tap(); setMenuOpen(o => !o); }}
        aria-label={menuOpen ? t("close") : t("add")}
      >
        <IconPlus size={26} strokeWidth={2.2} />
      </button>

      {/* + Paciente in the FAB menu opens NewPatientSheet in patient
          mode; the Potenciales chip's contextual CTA fires
          requestFabAction("potential") which routes to the same
          sheet pre-set to potential mode. The mode toggle at the
          top of the sheet lets the user flip either way without
          backing out. */}
      {(activeSheet === "patient" || activeSheet === "potential") && (
        <NewPatientSheet
          onClose={closeSheet}
          onSubmit={createPatient}
          onPotentialSubmit={createPotential}
          initialMode={activeSheet === "potential" ? "potential" : "patient"}
          mutating={mutating}
          patients={patients}
          sessions={upcomingSessions}
        />
      )}
      {activeSheet === "session" && (
        <NewSessionSheet onClose={closeSheet} onSubmit={createSession} patients={patients} sessions={upcomingSessions} mutating={mutating} />
      )}
      {activeSheet === "group" && (
        <NewGroupSheet onClose={closeSheet} />
      )}
      <QuickCaptureSheet
        open={quickCaptureOpen}
        onClose={() => setQuickCaptureOpen(false)}
        onSaved={(note, { openInEditor }) => {
          // Escalate-to-editor path: route the just-created note into
          // the full NoteEditor so the user can keep typing with all
          // the chrome (templates are skipped since the note has
          // content, but formatting / linking / find / outline / history
          // all work). The plain-save path just closes the sheet and
          // the note appears in the list / Inbox.
          if (openInEditor) setQuickNote(note);
        }}
      />
      {quickNote && (
        <NoteEditor
          note={quickNote}
          onSave={async ({ title, content }) => await updateNote(quickNote.id, { title, content })}
          onDelete={async () => { await deleteNote(quickNote.id); }}
          onClose={() => setQuickNote(null)}
        />
      )}
      {activeSheet === "document" && (
        <NewDocumentSheet onClose={closeSheet} patients={patients} upcomingSessions={upcomingSessions}
          uploadDocument={uploadDocument} />
      )}
    </>
  );
}
