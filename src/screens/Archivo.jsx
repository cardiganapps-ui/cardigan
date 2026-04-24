import { useState } from "react";
import { SegmentedControl } from "../components/SegmentedControl";
import { Notes } from "./Notes";
import { Documents } from "./Documents";

const TABS = [
  { k: "notas", l: "Notas" },
  { k: "documentos", l: "Documentos" },
];

export function Archivo() {
  const [tab, setTab] = useState("notas");

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
        <SegmentedControl items={TABS} value={tab} onChange={setTab} size="md" />
      </div>
      {tab === "notas" ? <Notes /> : <Documents />}
    </div>
  );
}
