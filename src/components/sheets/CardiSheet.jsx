import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconX, IconSparkle } from "../Icons";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useLayer } from "../../hooks/useLayer";
import { useCardigan } from "../../context/CardiganContext";
import { useCardiChat } from "../../hooks/useCardiChat";

/* ── CardiSheet ───────────────────────────────────────────────────────
   Bottom sheet hosting the Cardi chatbot. Same structural shape as
   CalendarLinkSheet — overlay + panel + handle + header + scrollable
   body — so dismissal (ESC, swipe-down, back-button via useLayer) is
   consistent with every other sheet in the app.

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

  // Built every render but cheap — useCardiChat memoizes on it via the
  // `context` arg so a stable reference isn't required.
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

  // Reset the thread + input whenever the sheet closes so the next
  // open starts fresh. Adjust-during-render pattern (same as Drawer's
  // prevOpen) — keeps `react-hooks/set-state-in-effect` happy.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      reset();
      setInput("");
    }
  }

  // Auto-scroll to the latest message whenever the thread changes or
  // the assistant starts thinking. requestAnimationFrame so layout has
  // settled with the new content's height.
  useEffect(() => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, pending]);

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
    // Cmd/Ctrl+Enter sends. Plain Enter inserts a newline (multi-line
    // questions are common — "¿cómo hago X y luego Y?").
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  if (!open) return null;

  const empty = messages.length === 0;

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
            <span style={{ color: "var(--teal-dark)", display: "inline-flex" }}><IconSparkle size={16} /></span>
            <span className="sheet-title">{t("cardi.title")}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={reset}
                style={{
                  background: "none", border: "none",
                  color: "var(--charcoal-md)",
                  fontSize: 13, fontWeight: 600,
                  padding: "6px 8px", cursor: "pointer",
                  fontFamily: "inherit",
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
            padding: "8px 16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
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
              {pending && <CardiThinking t={t} />}
            </>
          )}
        </div>

        {/* Input row */}
        <div style={{
          borderTop: "1px solid var(--border-lt)",
          padding: "10px 12px max(10px, var(--sab))",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          background: "var(--white)",
        }}>
          <textarea
            ref={inputRef}
            className="input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("cardi.placeholder")}
            rows={1}
            disabled={pending}
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 120,
              padding: "10px 12px",
              fontFamily: "inherit",
              resize: "none",
              fontSize: 14,
              lineHeight: 1.4,
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => submit()}
            disabled={pending || !input.trim()}
            style={{ height: 40, padding: "0 16px", flexShrink: 0 }}
          >
            {t("cardi.send")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CardiEmptyState({ t, onSuggest }) {
  return (
    <div style={{ padding: "20px 4px 12px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{
        background: "var(--teal-pale)",
        color: "var(--teal-dark)",
        padding: "12px 14px",
        borderRadius: "var(--radius)",
        fontSize: 14,
        lineHeight: 1.5,
      }}>
        {t("cardi.greeting")}
      </div>
      <div>
        <div style={{
          fontSize: 12,
          color: "var(--charcoal-md)",
          marginBottom: 8,
          fontWeight: 600,
        }}>
          {t("cardi.suggestedTitle")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {SUGGESTED_KEYS.map((key) => {
            const text = t(`cardi.suggested.${key}`);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSuggest(text)}
                className="btn btn-teal-soft"
                style={{
                  textAlign: "left",
                  padding: "10px 14px",
                  height: "auto",
                  fontSize: 13,
                  lineHeight: 1.4,
                  borderRadius: "var(--radius)",
                  justifyContent: "flex-start",
                }}
              >
                {text}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--charcoal-xl)", textAlign: "center", padding: "4px 8px" }}>
        {t("cardi.privacyNote")}
      </div>
    </div>
  );
}

function CardiBubble({ message, t, onRetry, pending }) {
  const isUser = message.role === "user";
  const isError = message.error;

  if (isError) {
    const text = message.errorKey ? t(message.errorKey) : (message.content || t("cardi.error"));
    return (
      <div style={{ alignSelf: "flex-start", maxWidth: "85%", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{
          background: "var(--red-bg)",
          color: "var(--red)",
          padding: "10px 12px",
          borderRadius: "var(--radius)",
          fontSize: 13,
          lineHeight: 1.45,
        }}>
          {text}
        </div>
        {message.errorKey !== "cardi.proRequired" && message.errorKey !== "cardi.noPii" && (
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
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: pending ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {t("cardi.error").includes("Reintentar") ? "Reintentar" : "Reintentar"}
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
        maxWidth: "85%",
        background: isUser ? "var(--teal)" : "var(--white)",
        color: isUser ? "var(--white)" : "var(--charcoal)",
        border: isUser ? "none" : "1px solid var(--border-lt)",
        padding: "10px 12px",
        borderRadius: "var(--radius)",
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {message.content}
    </div>
  );
}

function CardiThinking({ t }) {
  return (
    <div style={{
      alignSelf: "flex-start",
      background: "var(--white)",
      border: "1px solid var(--border-lt)",
      padding: "10px 14px",
      borderRadius: "var(--radius)",
      fontSize: 13,
      color: "var(--charcoal-md)",
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}>
      <ThinkingDots />
      <span style={{ fontSize: 12 }}>{t("cardi.thinking")}</span>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3 }} aria-hidden="true">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
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
