import React from "react";
import { Avatar } from "../../components/Avatar";
import { IconEdit } from "../../components/Icons";
import { useT } from "../../i18n/index";

export const AccountHeader = React.memo(function AccountHeader({
  userName, userEmail, userInitial, avatarImageUrl, readOnly,
  onOpenAvatar, onEditProfile,
}: {
  userName?: string;
  userEmail?: string;
  userInitial?: string;
  avatarImageUrl?: string | null;
  readOnly?: boolean;
  onOpenAvatar: () => void;
  onEditProfile: () => void;
}) {
  const { t } = useT();
  return (
    <div className="section" style={{ paddingTop:16 }}>
      <div className="card" style={{ padding:16 }}>
        <div className="flex items-center gap-3">
          <div
            className="av-settings-avatar"
            role={readOnly ? undefined : "button"}
            tabIndex={readOnly ? undefined : 0}
            aria-label={readOnly ? undefined : (t("avatar.changePhoto") || "Cambiar foto")}
            aria-disabled={readOnly ? "true" : undefined}
            onClick={readOnly ? undefined : onOpenAvatar}
            onKeyDown={readOnly ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenAvatar(); } }}
          >
            <Avatar
              initials={userInitial}
              color="var(--teal)"
              size="lg"
              imageUrl={avatarImageUrl}
            />
            {!readOnly && (
              <span className="av-settings-avatar-badge" aria-hidden="true">
                <IconEdit size={11} />
              </span>
            )}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"var(--font-d)",fontSize:"var(--text-lg)",fontWeight:800,color:"var(--charcoal)" }}>{userName}</div>
            <div style={{ fontSize:"var(--text-sm)",color:"var(--charcoal-xl)",marginTop:2 }}>{userEmail}</div>
          </div>
          <button className="btn btn-ghost" onClick={onEditProfile}>{t("edit")}</button>
        </div>
      </div>
    </div>
  );
});
