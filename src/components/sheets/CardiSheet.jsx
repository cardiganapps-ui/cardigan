import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconX, IconSparkle, IconArrowUp, IconChevron } from "../Icons";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useLayer } from "../../hooks/useLayer";
import { useCardigan } from "../../context/CardiganContext";
import { useCardiChat } from "../../hooks/useCardiChat";

/* ── CardiSheet ───────────────────────────────────────────────────────
   Bottom sheet hosting the Cardi AI helper. Same structural shape as
   the rest of the sheets — overlay + panel + handle + header + body +
   composer — so dismissal (ESC, swipe-down, back-button via useLayer)
   is consistent.

   v1 scope: navigation/help Q&A only. NEVER reads or sends patient
   data. Profession + screen + accessState + counts are passed as
   lightweight context so Cardi's vocabulary swaps (paciente / cliente)
   without exposing anything sensitive. */

const SUGGESTED_KEYS = ["schedule", "reminders", "calendar", "payment"];

export function CardiSheet({ open, onClose }) {
  const { t } = useT();
  const { profession, subscription, screen, patients = [] } = useCardigan();
  useEscape(open ? onClose : null);
  const panelRef = useFocusTrap(open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  useLayer(open ? "cardi" : null, onClose);

  const context = useMemo(() => ({
    profession,
    accessState: subscription?.accessState,
    screen,
    patientCount: patients.length,
  }), [profession, subscription?.accessState, screen, patients.length]);

  const { messages, pending, send, retry, reset } = useCardiChat({ context });

  const [input, setInput] = useState("");
  const inputRef = useRef(null);
  const bodyRef = useRef(null);

  // Reset thread + input on close. Adjust-during-render keeps
  // react-hooks/set-state-in-effect happy.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      reset();
      setInput("");
    }
  }

  useEffect(() => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, pending]);

  // Auto-resize the textarea so it grows with multi-line input but
  // never exceeds the configured cap. CSS-only auto-grow doesn't work
  // for textarea, so this is the standard "measure scrollHeight" trick.
  const adjustTextareaHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 120);
    el.style.height = `${next}px`;
  }, []);
  useEffect(() => { adjustTextareaHeight(); }, [input, adjustTextareaHeight]);

  const setPanel = useCallback((el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  }, [panelRef, scrollRef, setPanelEl]);

  const submit = useCallback((text) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || pending) return;
    setInput("");
    send(trimmed);
  }, [input, pending, send]);

  const onKeyDown = useCallback((e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  if (!open) return null;

  const empty = messages.length === 0;
  const canSend = !pending && input.trim().length > 0;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("cardi.title")}
        onClick={e => e.stopPropagation()}
        {...panelHandlers}
        style={{ maxHeight: "92vh", display: "flex", flexDirection: "column" }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--teal-dark)", display: "inline-flex" }}>
              <IconSparkle size={16} />
            </span>
            <span className="sheet-title">{t("cardi.title")}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={reset}
                style={{
                  background: "none", border: "none",
                  color: "var(--charcoal-md)",
                  fontSize: 13, fontWeight: 600,
                  padding: "6px 10px", cursor: "pointer",
                  fontFamily: "inherit",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {t("cardi.reset")}
              </button>
            )}
            <button className="sheet-close" aria-label={t("close")} onClick={onClose}>
              <IconX size={14} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div
          ref={bodyRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: empty ? "12px 20px 8px" : "12px 16px 8px",
            display: "flex",
            flexDirection: "column",
            gap: empty ? 0 : 8,
          }}
        >
          {empty ? (
            <CardiEmptyState
              t={t}
              onSuggest={(text) => submit(text)}
            />
          ) : (
            <>
              {messages.map((m, i) => (
                <CardiBubble
                  key={i}
                  message={m}
                  t={t}
                  onRetry={retry}
                  pending={pending}
                />
              ))}
              {pending && <CardiThinking />}
            </>
          )}
        </div>

        {/* Composer — the textarea + send button live in a single
            rounded container so they read as one element, like every
            modern chat input. The send button is icon-only so the
            label doesn't visually compete with the input text. */}
        <div style={{
          borderTop: "1px solid var(--border-lt)",
          padding: "10px 14px max(10px, var(--sab))",
          background: "var(--white)",
        }}>
          <div style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            background: "var(--cream)",
            borderRadius: 22,
            padding: "4px 4px 4px 14px",
            border: "1px solid transparent",
            transition: "border-color var(--dur-fast) ease, background-color var(--dur-fast) ease",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("cardi.placeholder")}
              rows={1}
              disabled={pending}
              aria-label={t("cardi.placeholder")}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 28,
                maxHeight: 120,
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "none",
                padding: "8px 0",
                fontFamily: "inherit",
                fontSize: 14,
                lineHeight: 1.45,
                color: "var(--charcoal)",
              }}
            />
            <button
              type="button"
              onClick={() => submit()}
              disabled={!canSend}
              aria-label={t("cardi.send")}
              style={{
                flexShrink: 0,
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: "none",
                background: canSend ? "var(--teal-dark)" : "var(--cream-deeper)",
                color: canSend ? "var(--white)" : "var(--charcoal-xl)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: canSend ? "pointer" : "default",
                transition: "background-color var(--dur-fast) ease, color var(--dur-fast) ease, transform var(--dur-fast) ease",
                WebkitTapHighlightColor: "transparent",
              }}
              onMouseDown={(e) => { if (canSend) e.currentTarget.style.transform = "scale(0.94)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
            >
              <IconArrowUp size={16} />
            </button>
          </div>
          <div style={{
            fontSize: 11,
            color: "var(--charcoal-xl)",
            textAlign: "center",
            marginTop: 8,
            lineHeight: 1.4,
          }}>
            {t("cardi.privacyNote")}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Empty state — a quiet greeting + a list of pressable suggestion
   rows (same row pattern as Settings, not chunky filled chips). The
   privacy note moved to the composer area; it's more relevant when
   the user is about to type than when they're scanning suggestions. */
function CardiEmptyState({ t, onSuggest }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 14, paddingBottom: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "0 8px" }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: "var(--teal-pale)", color: "var(--teal-dark)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconSparkle size={20} />
        </div>
        <div style={{
          fontSize: 14, lineHeight: 1.5,
          color: "var(--charcoal-md)",
          textAlign: "center",
          maxWidth: 320,
        }}>
          {t("cardi.greeting")}
        </div>
      </div>
      <div>
        <div style={{
          fontSize: "var(--text-eyebrow)",
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          color: "var(--charcoal-xl)",
          fontWeight: 700,
          padding: "0 4px 8px",
        }}>
          {t("cardi.suggestedTitle")}
        </div>
        <div style={{
          background: "var(--white)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border-lt)",
          overflow: "hidden",
        }}>
          {SUGGESTED_KEYS.map((key, i) => {
            const text = t(`cardi.suggested.${key}`);
            const isLast = i === SUGGESTED_KEYS.length - 1;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSuggest(text)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  width: "100%",
                  background: "none",
                  border: "none",
                  borderBottom: isLast ? "none" : "1px solid var(--border-lt)",
                  padding: "12px 14px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  lineHeight: 1.4,
                  color: "var(--charcoal)",
                  textAlign: "left",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  transition: "background-color var(--dur-fast) ease",
                }}
                onMouseDown={(e) => e.currentTarget.style.background = "var(--cream)"}
                onMouseUp={(e) => e.currentTarget.style.background = "none"}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                onTouchStart={(e) => e.currentTarget.style.background = "var(--cream)"}
                onTouchEnd={(e) => e.currentTarget.style.background = "none"}
              >
                <span>{text}</span>
                <span style={{ color: "var(--charcoal-xl)", flexShrink: 0, display: "inline-flex" }}>
                  <IconChevron size={14} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CardiBubble({ message, t, onRetry, pending }) {
  const isUser = message.role === "user";
  const isError = message.error;

  if (isError) {
    const text = message.errorKey ? t(message.errorKey) : (message.content || t("cardi.error"));
    const allowRetry = message.errorKey !== "cardi.proRequired" && message.errorKey !== "cardi.noPii";
    return (
      <div style={{ alignSelf: "flex-start", maxWidth: "88%", display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        <div style={{
          background: "var(--red-bg)",
          color: "var(--red)",
          padding: "10px 14px",
          borderRadius: 14,
          fontSize: 13,
          lineHeight: 1.45,
        }}>
          {text}
        </div>
        {allowRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={pending}
            style={{
              alignSelf: "flex-start",
              background: "none",
              border: "1px solid var(--red)",
              color: "var(--red)",
              borderRadius: "var(--radius-pill)",
              padding: "4px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: pending ? "default" : "pointer",
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="selectable"
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "88%",
        background: isUser ? "var(--teal-dark)" : "var(--white)",
        color: isUser ? "var(--white)" : "var(--charcoal)",
        border: isUser ? "none" : "1px solid var(--border-lt)",
        padding: "9px 13px",
        borderRadius: 16,
        // Slight asymmetry on the corner closest to the speaker — the
        // standard "speech bubble tail" cue used by every modern chat
        // UI. Keeps the radius uniform but signals direction.
        borderBottomRightRadius: isUser ? 6 : 16,
        borderBottomLeftRadius: isUser ? 16 : 6,
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        marginTop: 2,
      }}
    >
      {message.content}
    </div>
  );
}

function CardiThinking() {
  return (
    <div style={{
      alignSelf: "flex-start",
      background: "var(--white)",
      border: "1px solid var(--border-lt)",
      padding: "11px 14px",
      borderRadius: 16,
      borderBottomLeftRadius: 6,
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      marginTop: 2,
    }} aria-label="Cardi está pensando">
      <ThinkingDots />
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4 }} aria-hidden="true">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--charcoal-xl)",
            animation: `cardiDotPulse 1.2s ease-in-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes cardiDotPulse {
          0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </span>
  );
}
