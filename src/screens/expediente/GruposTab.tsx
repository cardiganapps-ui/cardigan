import { useState, useMemo } from "react";
import { Avatar } from "../../components/Avatar";
import { IconChevronRight } from "../../components/Icons";
import { EmptyState } from "../../components/EmptyState";
import { GroupDetail } from "../GroupDetail";
import { useCardigan } from "../../context/CardiganContext";
import { useT } from "../../i18n/index";
import { getClientColor } from "../../data/seedData";
import { activeMemberCount } from "../../utils/groups";
import { GROUP_STATUS } from "../../data/constants";
import { haptic } from "../../utils/haptics";

/* Patient expediente → Grupos tab. Lists the groups this patient is an
   active member of; tapping a row opens the full GroupDetail overlay. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed group/member rows
type Row = any;

export function GruposTab({ patient }: { patient: Row }) {
  const { t } = useT();
  const { groups, groupMembers } = useCardigan();
  const [openId, setOpenId] = useState<string | null>(null);

  const myGroups = useMemo(() => {
    const ids = new Set(
      (groupMembers || [])
        .filter((m: Row) => m.patient_id === patient.id && m.left_at == null)
        .map((m: Row) => m.group_id)
    );
    return (groups || [])
      .filter((g: Row) => ids.has(g.id))
      .sort((a: Row, b: Row) => {
        const ae = a.status === GROUP_STATUS.ENDED, be = b.status === GROUP_STATUS.ENDED;
        if (ae !== be) return ae ? 1 : -1;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [groups, groupMembers, patient.id]);

  const openGroup = groups.find((g: Row) => g.id === openId) || null;

  return (
    <div style={{ padding: 16 }}>
      {myGroups.length === 0 ? (
        <EmptyState kind="patients" compact title={t("groups.empty")} body={t("expediente.noGroupsBody")} />
      ) : (
        <div className="card">
          {myGroups.map((g: Row) => {
            const count = activeMemberCount(g, groupMembers);
            const ended = g.status === GROUP_STATUS.ENDED;
            const sub = [
              count === 1 ? t("groups.memberCountOne") : t("groups.membersCount", { count }),
              g.day && g.time ? `${g.day} ${g.time}` : null,
            ].filter(Boolean).join(" · ");
            return (
              <button key={g.id} className="row-item btn-tap"
                style={{ width: "100%", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", opacity: ended ? 0.6 : 1 }}
                onClick={() => { haptic.tap(); setOpenId(g.id); }}>
                <Avatar initials={(g.name || "?").slice(0, 2).toUpperCase()} color={getClientColor(g.colorIdx ?? g.color_idx ?? 0)} size="md" />
                <div className="row-content">
                  <div className="row-title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
                  <div className="row-sub">{sub}</div>
                </div>
                {ended && <span className="badge badge-gray">{t("groups.ended")}</span>}
                <span className="row-chevron" aria-hidden><IconChevronRight size={16} /></span>
              </button>
            );
          })}
        </div>
      )}

      {openGroup && <GroupDetail group={openGroup} onClose={() => setOpenId(null)} />}
    </div>
  );
}
