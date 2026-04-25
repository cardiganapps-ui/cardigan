import { useState, useRef, useEffect } from "react";
import { IconEye, IconEyeOff } from "./Icons";
import { useT } from "../i18n/index";

/* Password input with a closed-/open-eye reveal toggle on the right.

   Two layers of visibility:
   - "revealed" — the user tapped the eye, password stays visible until
     they tap again. Like a normal show/hide toggle.
   - "peek" — when not revealed, the most-recent keystroke briefly
     unmasks the field for ~700ms (resets on every keystroke). Mirrors
     the iOS keyboard's "last-typed letter visible" behaviour so the
     user can sanity-check what they're typing without leaving the
     password fully exposed.

   The wrapper preserves the .input class on the inner <input> so
   layouts that target .input (form rows in AuthScreen / Settings) keep
   working without churn. */
export function PasswordInput({ value, onChange, className = "input", style, ...props }) {
  const { t } = useT();
  const [revealed, setRevealed] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef(null);

  useEffect(() => () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
  }, []);

  const handleChange = (e) => {
    onChange?.(e);
    if (revealed) return;
    setPeeking(true);
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeeking(false), 700);
  };

  const visible = revealed || peeking;

  return (
    <div className="password-input" style={style}>
      <input
        {...props}
        type={visible ? "text" : "password"}
        value={value}
        onChange={handleChange}
        className={className}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="password-input-toggle"
        onClick={() => setRevealed(v => !v)}
        aria-label={revealed ? t("auth.hidePassword") : t("auth.showPassword")}
        aria-pressed={revealed}
        tabIndex={-1}
      >
        {revealed ? <IconEye size={18} /> : <IconEyeOff size={18} />}
      </button>
    </div>
  );
}
