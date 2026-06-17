import { Avatar } from "./Avatar";
import { IconUsers } from "./Icons";
import { useT } from "../i18n/index";
import { getClientColor } from "../data/seedData";
import { SESSION_STATUS } from "../data/constants";

/* Consolidated group occurrence tile for Agenda / Home. One row per
   occurrence (N members collapsed into a single tile) showing a single
   avatar with the GROUP initials, the group name (with the group glyph),
   time window, and member count. Reuses the .session-row shell +
   rail-{status} accent. Tap opens the occurrence sheet. */
export function GroupSessionRow({ occ, onClick }) {
  const { t } = useT();
  const g = occ.group;
  const colorIdx = g?.colorIdx ?? g?.color_idx ?? 0;
  const groupInitials = (g?.name || "?").slice(0, 2).toUpperCase();
  const rail = occ.status === SESSION_STATUS.CANCELLED ? "cancelled"
    : occ.status === SESSION_STATUS.COMPLETED ? "completed" : "scheduled";
  const endTime = (() => {
    const [h, m] = (occ.time || "0:0").split(":");
    const end = new Date(0, 0, 0, +h, +m);
    end.setMinutes(end.getMinutes() + (occ.duration || 60));
    return `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  })();

  return (
    <div className={`row-item session-row rail-${rail}`} onClick={onClick} style={{ cursor:"pointer" }}>
      <Avatar initials={groupInitials} color={getClientColor(colorIdx)} size="md" />
      <div className="row-content">
        <div className="row-title" style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
          <span style={{ color:getClientColor(colorIdx), display:"inline-flex" }}><IconUsers size={14} /></span>
          {g?.name || t("groups.title")}
        </div>
        <div className="row-sub">
          {occ.time} - {endTime}
          <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color:"var(--teal-dark)", marginLeft:6, textTransform:"uppercase" }}>
            {occ.count === 1 ? t("groups.memberCountOne") : t("groups.membersCount", { count: occ.count })}
          </span>
        </div>
      </div>
    </div>
  );
}
