import { useState, useMemo } from "react";
import { IconX, IconCheck, IconSearch } from "../Icons";
import { Avatar } from "../Avatar";
import { useT } from "../../i18n/index";
import { useCardiganMain } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { useLayer } from "../../hooks/useLayer";
import { getClientColor } from "../../data/seedData";
import { SheetOverlay } from "../SheetOverlay";

/* Multi-select existing active patients to add to a group. Already-active
   members are excluded from the list. "Agregar" batches addMembers, which
   backfills future occurrences for the new members. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed patient rows
type Row = any;

export function MembersPickerSheet({ groupId, existingPatientIds, onClose }: {
  groupId?: string;
  existingPatientIds?: string[];
  onClose: () => void;
}) {
  const { t } = useT();
  const { patients, addMembers, mutating } = useCardiganMain();
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(animatedClose);
  useLayer("members-picker", animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el: HTMLElement | null) => { panelRef.current = el; scrollRef.current = el; setPanelEl(el); };

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const existing = useMemo(() => new Set(existingPatientIds || []), [existingPatientIds]);

  const candidates = patients
    .filter((p: Row) => p.status === "active" && !existing.has(p.id))
    .filter((p: Row) => p.name.toLowerCase().includes(search.toLowerCase()));

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    if (!groupId || selected.size === 0) { animatedClose(); return; }
    const ok = await addMembers(groupId, [...selected]);
    if (ok) animatedClose();
  };

  return (
    <SheetOverlay exiting={exiting} onClose={animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" aria-label={t("groups.addMembers")} {...panelHandlers} style={{ maxHeight:"min(88lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("groups.addMembers")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 0" }}>
          <div className="input-help" style={{ marginBottom:10 }}>{t("groups.addMembersHint")}</div>
          <div className="search-bar" style={{ marginBottom:12 }}>
            <span style={{ color:"var(--charcoal-xl)" }}><IconSearch size={16} /></span>
            <input type="search" placeholder={t("patients.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {candidates.length === 0 ? (
            <div className="input-help" style={{ padding:"12px 0" }}>{t("patients.noResults")}</div>
          ) : (
            <div className="card" style={{ maxHeight:"50lvh", overflowY:"auto" }}>
              {candidates.map((p: Row, i: number) => {
                const on = selected.has(p.id);
                return (
                  <button key={p.id} type="button" className="row-item btn-tap" onClick={() => toggle(p.id)}
                    style={{ width:"100%", border:"none", background: on ? "var(--teal-mist)" : "transparent", textAlign:"left", cursor:"pointer" }}>
                    <Avatar initials={p.initials} color={getClientColor(i)} size="sm" />
                    <div className="row-content"><div className="row-title">{p.name}</div></div>
                    <span aria-hidden style={{ width:22, height:22, borderRadius:"var(--radius-pill)", display:"inline-flex", alignItems:"center", justifyContent:"center", border: on ? "none" : "2px solid var(--border)", background: on ? "var(--teal)" : "transparent", color:"var(--white)" }}>
                      {on && <IconCheck size={14} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 20px 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
          <button className="btn btn-primary-teal" type="button" disabled={mutating || selected.size === 0} style={{ width:"100%" }} onClick={submit}>
            {t("groups.addMembers")}{selected.size > 0 ? ` · ${selected.size}` : ""}
          </button>
        </div>
      </div>
    </SheetOverlay>
  );
}
