import { useState, useMemo } from "react";
import { IconSearch, IconPlus, IconChevronRight } from "../components/Icons";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { GroupDetail } from "./GroupDetail";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { getClientColor } from "../data/seedData";
import { activeMemberCount } from "../utils/groups";
import { GROUP_STATUS } from "../data/constants";
import { haptic } from "../utils/haptics";

/* Groups (Grupos) list screen — the 5th bottom-tab destination. Mirrors
   the Patients screen shell (search + .card list of .row-item rows), opens
   a GroupDetail overlay on tap. The FAB's "Grupo" quick action creates a
   group; the empty-state CTA routes to the same action. */
export function Groups() {
  const { t } = useT();
  const { groups, groupMembers, readOnly, requestFabAction } = useCardigan();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null);

  // Active groups first, then ended; alpha within each band.
  const sorted = useMemo(() => {
    return [...(groups || [])]
      .filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const ae = a.status === GROUP_STATUS.ENDED, be = b.status === GROUP_STATUS.ENDED;
        if (ae !== be) return ae ? 1 : -1;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [groups, search]);

  const openGroup = groups.find(g => g.id === openId) || null;

  if ((groups || []).length === 0) {
    return (
      <div className="page" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px" }}>
        <EmptyState
          kind="patients"
          title={t("groups.empty")}
          body={t("groups.emptyBody")}
          cta={!readOnly && (
            <button type="button" onClick={() => requestFabAction?.("group")} className="btn btn-primary"
              style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
              <IconPlus size={16} /> {t("groups.new")}
            </button>
          )}
        />
      </div>
    );
  }

  return (
    <div className="page page--reading">
      <div style={{ padding:"16px 16px 10px" }}>
        <div className="search-bar">
          <span style={{ color:"var(--charcoal-xl)" }}><IconSearch size={16} /></span>
          <input type="search" aria-label={t("groups.searchPlaceholder")} placeholder={t("groups.searchPlaceholder")}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div style={{ padding:"0 16px 16px" }}>
        {sorted.length === 0 ? (
          <EmptyState kind="patients" title={t("patients.noResults")} body="" />
        ) : (
          <div className="card">
            {sorted.map((g, i) => {
              const count = activeMemberCount(g, groupMembers);
              const ended = g.status === GROUP_STATUS.ENDED;
              const sub = [
                count === 1 ? t("groups.memberCountOne") : t("groups.membersCount", { count }),
                g.day && g.time ? `${g.day} ${g.time}` : null,
              ].filter(Boolean).join(" · ");
              return (
                <button key={g.id} className="row-item list-entry-stagger btn-tap"
                  style={{ "--stagger-i": Math.min(i, 12), width:"100%", border:"none", background:"transparent", textAlign:"left", cursor:"pointer", opacity: ended ? 0.6 : 1 }}
                  onClick={() => { haptic.tap(); setOpenId(g.id); }}>
                  <Avatar initials={(g.name || "?").slice(0, 2).toUpperCase()} color={getClientColor(g.colorIdx ?? g.color_idx ?? 0)} size="md" />
                  <div className="row-content">
                    <div className="row-title" style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{g.name}</div>
                    <div className="row-sub">{sub}</div>
                  </div>
                  {ended && <span className="badge badge-gray">{t("groups.ended")}</span>}
                  <span className="row-chevron" aria-hidden><IconChevronRight size={16} /></span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {openGroup && <GroupDetail group={openGroup} onClose={() => setOpenId(null)} />}
    </div>
  );
}
