import { useState, useMemo, useEffect, useRef } from "react";
import { getClientColor } from "../../data/seedData";
import { IconPlus, IconChevron } from "../../components/Icons";
import { Toggle } from "../../components/Toggle";
import { shortDateToISO, todayISO } from "../../utils/dates";
import { formatMXN } from "../../utils/format";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Avatar } from "../../components/Avatar";
import { SwipeableRow } from "../../components/SwipeableRow";
import { EmptyState } from "../../components/EmptyState";
import { useT } from "../../i18n/index";
import { clickableProps } from "../../utils/a11y";
import { FINANCES_INITIAL_WINDOW, FINANCES_WINDOW_INCREMENT, getDateFrom } from "./financesShared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed payment/patient rows
type Row = any;

export function PagosTab({ payments, patients, onRecordPayment, onEditPayment, onDeletePayment, mutating, onAddFirstPatient }: {
  payments: Row[];
  patients: Row[];
  onRecordPayment: (arg: Row | null) => void;
  onEditPayment: (p: Row) => void;
  onDeletePayment: (id: string) => Promise<unknown> | unknown;
  mutating?: boolean;
  onAddFirstPatient?: () => void;
}) {
  const { t } = useT();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [groupByClient, setGroupByClient] = useState(false);
  // Patient-name keyed: which grouped row is expanded to show its
  // individual payments. Independent of `expandedId` (which controls
  // the per-payment edit/delete actions reveal) so the two expansion
  // levels nest cleanly.
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [period, setPeriod] = useState("all");
  // Lazy-load window. Rendering every payment row up-front was the
  // single worst scroll-jank source on iOS Safari — a therapist with
  // 1000+ payments paid ~500ms layout cost on tab open. With the
  // window, first paint renders 60 rows; an IntersectionObserver
  // sentinel pulls 40 more as the user scrolls toward the end.
  const [visibleCount, setVisibleCount] = useState(FINANCES_INITIAL_WINDOW);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset the visible window on filter change. The deps intentionally
  // don't include the full `filtered` array (changes on every render
  // due to identity); `period` + `groupByClient` capture the real
  // user-initiated reasons to re-anchor. Synchronous setState in the
  // effect is deliberate — the new window needs to be in place in the
  // same commit or the user sees a flash of the old row count.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(FINANCES_INITIAL_WINDOW);
    // Collapse any open grouped-patient row when the filter set
    // changes — the previously-expanded patient may no longer match,
    // and re-anchoring scroll alongside a stale expansion looks broken.
    setExpandedGroup(null);
  }, [period, groupByClient, payments.length]);

  const { filtered, totalFiltered, grouped } = useMemo(() => {
    const dateFrom = getDateFrom(period);
    const today = todayISO();
    let list = [...payments];
    if (dateFrom) list = list.filter((p: Row) => {
      const iso = shortDateToISO(p.date);
      return iso >= dateFrom && iso <= today;
    });
    list.sort((a: Row, b: Row) => shortDateToISO(b.date).localeCompare(shortDateToISO(a.date)));
    const total = list.reduce((s: number, p: Row) => s + p.amount, 0);
    const byPatient: Record<string, Row[]> = {};
    for (const p of list) {
      if (!byPatient[p.patient]) byPatient[p.patient] = [];
      byPatient[p.patient].push(p);
    }
    return { filtered: list, totalFiltered: total, grouped: byPatient };
  }, [payments, period]);

  // Hook the sentinel to grow the window as the user scrolls. The
  // observer is (re)created whenever the filtered count changes so a
  // new sentinel (after the list shrinks below the previous window)
  // gets picked up. rootMargin preloads before the sentinel enters the
  // viewport — a therapist scrolling fast shouldn't feel the stall.
  useEffect(() => {
    if (visibleCount >= filtered.length) return;
    if (typeof IntersectionObserver === "undefined") return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisibleCount(n => Math.min(n + FINANCES_WINDOW_INCREMENT, filtered.length));
      }
    }, { rootMargin: "240px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, filtered.length]);

  // `nested` flips this row into the "child-of-a-grouped-patient" look:
  // drops the redundant avatar (the parent row already shows it), shrinks
  // the visual weight, and shifts the row right so the spine on the
  // wrapper draws the eye through the subset. Keeps the same expand /
  // swipe-to-delete interactions as the top-level row.
  const renderRow = (p: Row, i: number, nested = false) => {
    const patient = patients.find((pt: Row) => pt.name === p.patient);
    const isExpanded = expandedId === p.id;
    const rowBody = (
      <div
        className="bal-row"
        {...clickableProps(() => setExpandedId(isExpanded ? null : p.id))}
        style={{
          cursor: "pointer",
          // SwipeableRow stages a red delete button BEHIND the row and
          // slides the row over it; `overflow:hidden` + an OPAQUE row is
          // what hides the action at rest. `--teal-mist` is opaque in
          // light mode (#F2F9FB) but TRANSLUCENT in dark mode
          // (rgba(...,0.08)), so on dark themes the red "Eliminar" bled
          // straight through the nested row and overlapped the amount.
          // color-mix(teal 8% over --white) reproduces the teal-mist tint
          // as a fully OPAQUE surface in BOTH themes (both inputs are
          // opaque), matching the subset-container lane while keeping the
          // action button hidden until swiped.
          background: nested ? "color-mix(in srgb, var(--teal) 8%, var(--white))" : "var(--white)",
          ...(nested ? { paddingLeft: 36, minHeight: 48, gap: 10 } : {}),
        }}
      >
        {nested ? (
          // Bullet marker — pinned to the spine on the wrapper. Replaces
          // the avatar (redundant since the parent row owns identity).
          <span
            aria-hidden="true"
            style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "var(--teal)",
              flexShrink: 0,
              // Halo matches the wrapper bg so the dot reads as
              // punched through the thread spine (the spine sits at
              // x=28, the dot lands at ~x=28-30, halo covers the
              // 2px line behind the dot).
              boxShadow: "0 0 0 3px var(--teal-mist)",
            }}
          />
        ) : (
          <Avatar
            initials={patient ? patient.initials : p.patient.slice(0,2).toUpperCase()}
            color={getClientColor(p.colorIdx ?? i)} size="sm"
          />
        )}
        <div style={{ flex:1, minWidth:0 }}>
          {!groupByClient && <div className="bal-name">{p.patient}</div>}
          <div className="bal-sub" style={{
            display:"flex", alignItems:"center", gap:6,
            marginTop: groupByClient ? 0 : 2,
            fontSize: nested ? 12 : undefined,
          }}>
            <span>{p.date}</span>
            <span style={{ width:3, height:3, borderRadius:"50%", background:"var(--charcoal-xl)", display:"inline-block" }} />
            <span>{p.method}</span>
          </div>
        </div>
        <div className={`bal-amt amount-paid${nested ? " amount-paid--nested" : ""}`}
          style={nested ? { fontSize: 14, fontWeight: 700 } : undefined}>
          +{formatMXN(p.amount)}
        </div>
      </div>
    );
    return (
      <div
        key={p.id}
        className="list-entry-stagger"
        style={{ "--stagger-i": Math.min(i, 12) } as React.CSSProperties}
      >
        <SwipeableRow
          onAction={async () => { if (!mutating) await onDeletePayment(p.id); }}
          actionLabel={t("delete")}
          actionTone="danger">
          {rowBody}
        </SwipeableRow>
        {isExpanded && (
          <div style={{ padding:"8px 12px 12px", borderBottom:"1px solid var(--border-lt)" }}>
            {confirmDeleteId === p.id ? (
              <div style={{ background:"var(--red-bg)", borderRadius:"var(--radius)", padding:"10px 12px" }}>
                <div style={{ fontSize:"var(--text-md)", fontWeight:700, color:"var(--red)", marginBottom:4 }}>
                  {t("finances.deleteConfirm")}
                </div>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.4, marginBottom:10 }}>
                  {t("finances.deleteWarning")}
                </div>
                <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
                  <button className="btn btn-secondary" style={{ height:36, padding:"0 14px", fontSize:"var(--text-sm)", width:"auto", minHeight:0 }}
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>
                    {t("cancel")}
                  </button>
                  <button className="btn btn-danger" style={{ height:36, padding:"0 14px", fontSize:"var(--text-sm)", width:"auto", minHeight:0 }}
                    disabled={mutating}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await onDeletePayment(p.id);
                      setConfirmDeleteId(null);
                      setExpandedId(null);
                    }}>
                    {mutating ? t("patients.deleting") : t("delete")}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
                <button className="btn btn-secondary" style={{ height:36, padding:"0 14px", fontSize:"var(--text-sm)", width:"auto", minHeight:0, background:"var(--teal-pale)", color:"var(--teal-dark)", borderColor:"var(--teal-pale)" }}
                  onClick={(e) => { e.stopPropagation(); setExpandedId(null); onEditPayment(p); }}>
                  {t("edit")}
                </button>
                <button className="btn btn-danger" style={{ height:36, padding:"0 14px", fontSize:"var(--text-sm)", width:"auto", minHeight:0 }}
                  disabled={mutating} onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(p.id); }}>
                  {t("finances.deletePayment")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding:"0 16px" }}>
      <div style={{ marginBottom:14 }}>
        <button className="btn btn-primary" style={{ width:"100%" }} onClick={() => onRecordPayment(null)} disabled={mutating}>
          {mutating ? t("saving") : t("finances.registerPayment")}
        </button>
      </div>

      <div style={{ marginBottom:12 }}>
        <SegmentedControl
          value={period}
          onChange={setPeriod}
          ariaLabel={t("periods.all")}
          style={{ marginBottom: 8 }}
          items={[
            { k: "all", l: t("periods.all") },
            { k: "1w",  l: t("periods.1w") },
            { k: "1m",  l: t("periods.1m") },
            { k: "3m",  l: t("periods.3m") },
          ]}
        />
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-start", gap:8 }}>
          <Toggle on={groupByClient} onToggle={() => setGroupByClient(g => !g)} />
          <span style={{ fontSize:"var(--text-xs)", fontWeight:600, color:"var(--charcoal-md)" }}>{t("finances.groupByClient")}</span>
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", fontWeight:600 }}>
          {groupByClient
            ? t("finances.patientCount", { count: Object.keys(grouped).length })
            : t("finances.paymentCount", { count: filtered.length })}
        </span>
        <span style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--green)" }}>+{formatMXN(totalFiltered)}</span>
      </div>

      {filtered.length === 0
        ? (() => {
            // Two sources of "no payments visible": the user has
            // never recorded a payment yet (first-time state — show
            // the CTA), or there's a filter applied that just doesn't
            // match anything (subsequent state — no CTA, the user
            // adjusts the filter). For brand-new users with zero
            // patients, the CTA points at patient creation instead.
            const noPatients = (patients || []).length === 0;
            const hasAnyPayments = (payments || []).length > 0;
            const action = !hasAnyPayments && !noPatients ? (
              <button
                type="button"
                onClick={() => onRecordPayment(null)}
                className="btn btn-primary"
                style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
                <IconPlus size={16} /> {t("finances.recordFirst")}
              </button>
            ) : noPatients ? (
              <button
                type="button"
                onClick={onAddFirstPatient}
                className="btn btn-primary"
                style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
                <IconPlus size={16} /> {t("patients.addFirstCta")}
              </button>
            ) : null;
            return (
              <div className="card" style={{ padding: 0 }}>
                <EmptyState
                  kind="finances"
                  compact={hasAnyPayments}
                  title={hasAnyPayments ? t("finances.noPaymentsInPeriod") : t("finances.noPayments")}
                  body={t("finances.emptyBody")}
                  cta={action}
                />
              </div>
            );
          })()
        : groupByClient
          ? <div className="card">
              {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([name, pList], gi: number) => {
                const total = pList.reduce((s: number, p: Row) => s + p.amount, 0);
                const first = pList[0];
                const patient = patients.find((pt: Row) => pt.name === name);
                const isOpen = expandedGroup === name;
                return (
                  <div key={name}>
                    <div
                      className="bal-row"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => setExpandedGroup(isOpen ? null : name)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setExpandedGroup(isOpen ? null : name);
                        }
                      }}
                      style={{ cursor: "pointer", background: "var(--white)" }}
                    >
                      <Avatar initials={patient ? patient.initials : name.slice(0,2).toUpperCase()}
                        color={getClientColor(first?.colorIdx ?? gi)} size="sm" />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div className="bal-name">{name}</div>
                        <div className="bal-sub">{t("finances.paymentCount", { count: pList.length })}</div>
                      </div>
                      <div className="bal-amt amount-paid" style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
                        +{formatMXN(total)}
                        <span aria-hidden="true" style={{
                          display:"inline-flex",
                          color:"var(--charcoal-xl)",
                          transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform var(--dur-fast) var(--ease-spring)",
                        }}>
                          <IconChevron size={14} />
                        </span>
                      </div>
                    </div>
                    {isOpen && (
                      // Subset container. Reads as "these payments belong
                      // to the patient above" via three layered cues:
                      //   1. Tinted background that's visibly distinct
                      //      from the white card surface (and from the
                      //      darker shell in dark mode — --teal-mist
                      //      flips correctly in both palettes).
                      //   2. A 2px vertical thread on the left, aligned
                      //      with the parent row's avatar center, that
                      //      draws the eye from the parent through the
                      //      children.
                      //   3. Inset rows (no redundant avatar) — see
                      //      renderRow's `nested` branch above.
                      // Combined, the expansion reads as a clear child
                      // group at a glance.
                      <div style={{
                        position: "relative",
                        background: "var(--teal-mist)",
                        borderTop: "1px solid var(--border-lt)",
                      }}>
                        <span
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            left: 28,
                            top: 4,
                            bottom: 12,
                            width: 2,
                            background: "var(--teal-light)",
                            borderRadius: 2,
                            pointerEvents: "none",
                          }}
                        />
                        {pList.map((p: Row, i: number) => renderRow(p, i, true))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          : (
            <div className="card">
              {filtered.slice(0, visibleCount).map((p: Row, i: number) => renderRow(p, i))}
              {visibleCount < filtered.length && (
                // Sentinel + subtle hint so the blank band below the
                // last visible row doesn't read as "no more rows".
                <div ref={sentinelRef} style={{
                  padding: "14px 16px",
                  textAlign: "center",
                  fontSize: "var(--text-xs)",
                  color: "var(--charcoal-xl)",
                }}>
                  …
                </div>
              )}
            </div>
          )
      }

    </div>
  );
}
