import { useMemo } from "react";
import { useT } from "../../i18n/index";
import { extractOutline } from "./outlineUtil";

/* ── Cardigan notes — auto-generated outline ───────────────────────
   Reads the note's raw markdown, extracts `#` / `##` / `###`
   headings, and renders a clickable list. Selecting a heading calls
   `onJump(lineIdx)` so the parent can scroll the editor to it. */

export function NoteOutline({ content, onJump, variant = "drawer" }) {
  const { t } = useT();
  const items = useMemo(() => extractOutline(content), [content]);

  return (
    <div className={"mde-outline mde-outline--" + variant}>
      <div className="mde-outline-title">{t("notes.outline")}</div>
      {items.length === 0
        ? <div className="mde-outline-empty">{t("notes.outlineEmpty")}</div>
        : <ul className="mde-outline-list">
            {items.map((it, idx) => (
              <li
                key={idx}
                className={"mde-outline-item mde-outline-lvl-" + it.level}
                onClick={() => onJump(it.line)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onJump(it.line); } }}
              >
                <span className="mde-outline-dot" />
                <span className="mde-outline-text">{it.text}</span>
              </li>
            ))}
          </ul>}
    </div>
  );
}
