import { useState } from "react";
import { IconUserPlus, IconDollar, IconCalendarPlus, IconClipboard, IconDocument, IconPlus } from "./Icons";
import { NewPatientSheet } from "./sheets/NewPatientSheet";
import { NewSessionSheet } from "./sheets/NewSessionSheet";
import { NewDocumentSheet } from "./sheets/NewDocumentSheet";
import { NoteEditor } from "./NoteEditor";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

const ACTIONS = [
  { key:"patient",  Icon: IconUserPlus,     tKey:"fab.patient" },
  { key:"note",     Icon: IconClipboard,    tKey:"fab.note" },
  { key:"document", Icon: IconDocument,     tKey:"fab.document" },
  { key:"payment",  Icon: IconDollar,       tKey:"fab.payment" },
  { key:"session",  Icon: IconCalendarPlus, tKey:"fab.session" },
];

export function QuickActions() {
  const { t } = useT();
  const { patients, upcomingSessions, openRecordPaymentModal, createPatient, createSession, createNote, updateNote, deleteNote, uploadDocument, mutating } = useCardigan();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState(null);
  const [quickNote, setQuickNote] = useState(null);

  const handleAction = async (key) => {
    setMenuOpen(false);
    if (key === "payment") openRecordPaymentModal(null);
    else if (key === "note") {
      // Quick-capture: skip the sheet, go straight to editor
      const note = await createNote({ patientId: null, sessionId: null, title: "", content: "" });
      if (note) setQuickNote(note);
    }
    else setActiveSheet(key);
  };

  const closeSheet = () => setActiveSheet(null);

  return (
    <>
      {menuOpen && <div className="fab-overlay" onClick={() => setMenuOpen(false)} />}
      {menuOpen && (
        <div className="fab-menu">
          {ACTIONS.map((a, i) => (
            <button key={a.key} className="fab-action" style={{ animationDelay:`${i * 0.04}s` }} onClick={() => handleAction(a.key)}>
              <span className="fab-action-label">{t(a.tKey)}</span>
              <span className="fab-action-icon"><a.Icon size={16} /></span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`fab ${menuOpen ? "fab-open" : ""}`}
        data-tour="fab"
        onClick={() => setMenuOpen(o => !o)}
        aria-label={menuOpen ? "Cerrar" : "Agregar"}
      >
        <IconPlus size={26} strokeWidth={2.2} />
      </button>

      {activeSheet === "patient" && (
        <NewPatientSheet onClose={closeSheet} onSubmit={createPatient} mutating={mutating} patients={patients} />
      )}
      {activeSheet === "session" && (
        <NewSessionSheet onClose={closeSheet} onSubmit={createSession} patients={patients} mutating={mutating} />
      )}
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
