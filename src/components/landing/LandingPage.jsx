import { useEffect, useRef } from "react";
import { LogoIcon } from "../LogoMark";
import { ProductPreview } from "./ProductPreview";

/* ── Shared primitives ───────────────────────────────────────────── */
function CTAButton({ variant = "primary", onClick, children, type = "button" }) {
  return (
    <button type={type} className={`lp-btn lp-btn--${variant}`} onClick={onClick}>
      {children}
    </button>
  );
}

/* Mini UI fragments — these are tiny real-looking slices of the app, not text
   paragraphs. They're what gives the feature strip its dynamic, premium feel. */
function MiniCalendar() {
  const cells = ["L", "M", "X", "J", "V", "S", "D"];
  return (
    <div className="lp-mini lp-mini--cal" aria-hidden="true">
      <div className="lp-mini-cal-header">
        {cells.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="lp-mini-cal-grid">
        {Array.from({ length: 21 }).map((_, i) => {
          const isToday = i === 9;
          return <span key={i} className={`lp-mini-cal-day${isToday ? " is-today" : ""}`} />;
        })}
      </div>
      <div className="lp-mini-cal-events">
        <span className="lp-mini-pill lp-mini-pill--teal">09:00 · Andrea</span>
        <span className="lp-mini-pill lp-mini-pill--blue">15:00 · David</span>
      </div>
    </div>
  );
}

function MiniPatient() {
  return (
    <div className="lp-mini lp-mini--patient" aria-hidden="true">
      <div className="lp-mini-patient-row">
        <span className="lp-mini-av">A</span>
        <div className="lp-mini-patient-main">
          <div className="lp-mini-patient-name">Andrea Morales</div>
          <div className="lp-mini-patient-sub">Próx. sesión · jue 10:30</div>
        </div>
        <span className="lp-mini-badge">Al día</span>
      </div>
      <div className="lp-mini-patient-row lp-mini-patient-row--alt">
        <span className="lp-mini-av lp-mini-av--purple">C</span>
        <div className="lp-mini-patient-main">
          <div className="lp-mini-patient-name">Carlos Ruiz</div>
          <div className="lp-mini-patient-sub">Tutor · mar 17:00</div>
        </div>
        <span className="lp-mini-badge lp-mini-badge--amber">Saldo $450</span>
      </div>
    </div>
  );
}

function MiniKpi() {
  return (
    <div className="lp-mini lp-mini--kpi" aria-hidden="true">
      <div className="lp-mini-kpi-label">Cobrado este mes</div>
      <div className="lp-mini-kpi-value">$18,240</div>
      <svg className="lp-mini-spark" width="100%" height="48" viewBox="0 0 180 48" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lpSparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--teal)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 38 L20 32 L40 36 L60 26 L80 30 L100 18 L120 22 L140 12 L160 16 L180 6 L180 48 L0 48 Z"
          fill="url(#lpSparkFill)" />
        <path d="M0 38 L20 32 L40 36 L60 26 L80 30 L100 18 L120 22 L140 12 L160 16 L180 6"
          fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="lp-mini-kpi-foot">
        <span className="lp-mini-kpi-delta">+12% vs. mes anterior</span>
      </div>
    </div>
  );
}

/* ── Landing page ────────────────────────────────────────────────── */
export function LandingPage({ onPrimary, onSecondary, onLogin }) {
  const rootRef = useRef(null);

  /* Single IntersectionObserver stagger-fade for feature cards + steps.
     Respects prefers-reduced-motion via the .is-in CSS transition, which the
     reduced-motion guard in landing.css neutralizes. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = root.querySelectorAll("[data-reveal]");
    if (!targets.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -40px 0px" }
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  return (
    <div className="lp-root" ref={rootRef}>
      {/* Nav */}
      <nav className="lp-nav" aria-label="Primary">
        <div className="lp-container lp-nav-inner">
          <a href="#hero" className="lp-nav-brand" aria-label="Inicio de Cardigan">
            <LogoIcon size={22} color="var(--charcoal)" />
            <span>cardigan</span>
          </a>
          <div className="lp-nav-actions">
            <button type="button" className="lp-nav-link" onClick={onLogin}>
              Iniciar sesión
            </button>
            <CTAButton variant="primary" onClick={onPrimary}>
              Comenzar gratis
            </CTAButton>
          </div>
        </div>
      </nav>

      {/* 1. Hero + Preview */}
      <section id="hero" className="lp-section lp-hero" aria-labelledby="lp-hero-title">
        <div className="lp-glow" aria-hidden="true" />
        <div className="lp-container lp-hero-grid">
          <div className="lp-hero-copy">
            <h1 id="lp-hero-title" className="lp-hero-title">
              Tu consultorio, <span className="lp-accent">en orden.</span>
            </h1>
            <p className="lp-hero-sub">
              Citas, pacientes y cobros en un solo lugar.
            </p>
            <div className="lp-hero-ctas">
              <CTAButton variant="primary" onClick={onPrimary}>
                Comenzar gratis
              </CTAButton>
              <CTAButton variant="secondary" onClick={onSecondary}>
                Probar demo
              </CTAButton>
            </div>
          </div>

          <div className="lp-hero-preview">
            <ProductPreview />
          </div>
        </div>
      </section>

      {/* 2. Feature strip — visual proof, not paragraphs */}
      <section id="features" className="lp-section">
        <div className="lp-container">
          <div className="lp-features">
            <article className="lp-feature-v2" data-reveal style={{ "--i": 0 }}>
              <MiniCalendar />
              <div className="lp-feature-label">Tu día, claro.</div>
            </article>
            <article className="lp-feature-v2" data-reveal style={{ "--i": 1 }}>
              <MiniPatient />
              <div className="lp-feature-label">Cada paciente, una vista.</div>
            </article>
            <article className="lp-feature-v2" data-reveal style={{ "--i": 2 }}>
              <MiniKpi />
              <div className="lp-feature-label">Ingresos al día.</div>
            </article>
          </div>
        </div>
      </section>

      {/* 3. Cómo empezar — the path to utilization */}
      <section id="start" className="lp-section lp-start">
        <div className="lp-container">
          <ol className="lp-steps">
            <li className="lp-step" data-reveal style={{ "--i": 0 }}>
              <span className="lp-step-num">1</span>
              <span className="lp-step-label">Crea tu cuenta</span>
            </li>
            <li className="lp-step" data-reveal style={{ "--i": 1 }}>
              <span className="lp-step-num">2</span>
              <span className="lp-step-label">Agrega un paciente</span>
            </li>
            <li className="lp-step" data-reveal style={{ "--i": 2 }}>
              <span className="lp-step-num">3</span>
              <span className="lp-step-label">Agenda una sesión</span>
            </li>
          </ol>
        </div>
      </section>

      {/* 4. Final CTA */}
      <section id="final-cta" className="lp-section lp-section--dark" aria-labelledby="lp-final-title">
        <div className="lp-container">
          <h2 id="lp-final-title" className="lp-final-title">
            Toma el control de tu consultorio.
          </h2>
          <div className="lp-hero-ctas lp-hero-ctas--center">
            <CTAButton variant="primary" onClick={onPrimary}>
              Comenzar gratis
            </CTAButton>
            <CTAButton variant="secondary" onClick={onSecondary}>
              Probar demo
            </CTAButton>
          </div>
        </div>
      </section>

      {/* 5. Footer */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <LogoIcon size={14} color="var(--charcoal-xl)" />
            <span>cardigan</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
