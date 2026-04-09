import { useState } from "react";
import { IconUserPlus, IconDollar, IconCalendarPlus, IconClipboard, IconDocument } from "./Icons";
import { NewPatientSheet } from "./sheets/NewPatientSheet";
import { NewSessionSheet } from "./sheets/NewSessionSheet";
import { NewNoteSheet } from "./sheets/NewNoteSheet";
import { NewDocumentSheet } from "./sheets/NewDocumentSheet";

const ACTIONS = [
  { key:"patient",  Icon: IconUserPlus,     label:"Paciente" },
  { key:"payment",  Icon: IconDollar,       label:"Pago" },
  { key:"session",  Icon: IconCalendarPlus, label:"Sesión" },
  { key:"note",     Icon: IconClipboard,    label:"Nota" },
  { key:"document", Icon: IconDocument,     label:"Documento" },
];

export function QuickActions({
  patients, upcomingSessions,
  onOpenPaymentModal, createPatient, createSession,
  createNote, updateNote, deleteNote, uploadDocument, mutating,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState(null);

  const handleAction = (key) => {
    setMenuOpen(false);
    if (key === "payment") onOpenPaymentModal();
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
              <span className="fab-action-label">{a.label}</span>
              <span className="fab-action-icon"><a.Icon size={16} /></span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`fab ${menuOpen ? "fab-open" : ""}`}
        onClick={() => setMenuOpen(o => !o)}
        aria-label={menuOpen ? "Cerrar" : "Agregar"}
      >+</button>

      {activeSheet === "patient" && (
        <NewPatientSheet onClose={closeSheet} onSubmit={createPatient} mutating={mutating} patients={patients} />
      )}
      {activeSheet === "session" && (
        <NewSessionSheet onClose={closeSheet} onSubmit={createSession} patients={patients} mutating={mutating} />
      )}
      {activeSheet === "note" && (
        <NewNoteSheet onClose={closeSheet} patients={patients} upcomingSessions={upcomingSessions}
          createNote={createNote} updateNote={updateNote} deleteNote={deleteNote} />
      )}
      {activeSheet === "document" && (
        <NewDocumentSheet onClose={closeSheet} patients={patients} upcomingSessions={upcomingSessions}
          uploadDocument={uploadDocument} />
      )}
    </>
  );
}
