import { useMemo } from "react";
import { useT } from "../../i18n/index";
import { extractOutline } from "./outlineUtil";

/* ── Cardigan notes — auto-generated outline ───────────────────────
   Reads the note's raw markdown, extracts `#` / `##` / `###`
   headings, and renders a clickable list. Selecting a heading calls
   `onJump(lineIdx)` so the parent can scroll the editor to it. */

export function NoteOutline({ content, onJump, variant = "drawer", activeLine = null }: {
  content?: string | null;
  onJump: (line: number) => void;
  variant?: string;
  activeLine?: number | null;
}) {
  const { t } = useT();
  const items = useMemo(() => extractOutline(content), [content]);

  return (
    <div className={"mde-outline mde-outline--" + variant}>
      <div className="mde-outline-title">{t("notes.outline")}</div>
      {items.length === 0
        ? <div className="mde-outline-empty">{t("notes.outlineEmpty")}</div>
        : <ul className="mde-outline-list">
            {items.map((it, idx) => {
              const isActive = activeLine != null && it.line === activeLine;
              return (
                <li
                  key={idx}
                  className={"mde-outline-item note-outline-entry mde-outline-lvl-" + it.level + (isActive ? " is-active" : "")}
                  onClick={() => onJump(it.line)}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? "true" : undefined}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onJump(it.line); } }}
                >
                  <span className="mde-outline-dot" />
                  <span className="mde-outline-text">{it.text}</span>
                </li>
              );
            })}
          </ul>}
    </div>
  );
}
