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

/* Mini UI fragments — tiny, faithful slices of the real app. Each one is
   a snippet of a screen a Cardigan user actually sees: a session list, a
   patient list, and the Finances KPI pair. Nothing invented. */
function MiniSessions() {
  return (
    <div className="lp-mini lp-mini--sessions" aria-hidden="true">
      <div className="lp-mini-row lp-mini-row--completed">
        <span className="lp-mini-av" style={{ background: "var(--teal)" }}>A</span>
        <div className="lp-mini-row-main">
          <div className="lp-mini-row-title">Andrea M.</div>
          <div className="lp-mini-row-sub">
            <span>09:00 - 09:50</span>
            <span className="lp-mini-eyebrow lp-mini-eyebrow--presencial">PRESENCIAL</span>
          </div>
        </div>
        <span className="lp-mini-badge lp-mini-badge--completed">Completada</span>
      </div>
      <div className="lp-mini-row lp-mini-row--scheduled">
        <span className="lp-mini-av" style={{ background: "var(--blue)" }}>C</span>
        <div className="lp-mini-row-main">
          <div className="lp-mini-row-title">Carlos R.</div>
          <div className="lp-mini-row-sub">
            <span>10:30 - 11:20</span>
            <span className="lp-mini-eyebrow lp-mini-eyebrow--virtual">VIRTUAL</span>
          </div>
        </div>
        <span className="lp-mini-badge lp-mini-badge--scheduled">Agendada</span>
      </div>
    </div>
  );
}

function MiniPatients() {
  return (
    <div className="lp-mini lp-mini--patients" aria-hidden="true">
      <div className="lp-mini-row">
        <span className="lp-mini-av" style={{ background: "var(--teal)" }}>A</span>
        <div className="lp-mini-row-main">
          <div className="lp-mini-row-title">Andrea Morales</div>
          <div className="lp-mini-row-sub">$850 por sesión</div>
        </div>
        <span className="lp-mini-badge lp-mini-badge--active">Activo</span>
      </div>
      <div className="lp-mini-row">
        <span className="lp-mini-av" style={{ background: "var(--purple)" }}>C</span>
        <div className="lp-mini-row-main">
          <div className="lp-mini-row-title">Carlos Ruiz</div>
          <div className="lp-mini-row-sub">
            <span className="lp-mini-tutor">TUTOR:</span> Laura R. · $700
          </div>
        </div>
        <span className="lp-mini-badge lp-mini-badge--active">Activo</span>
      </div>
    </div>
  );
}

function MiniFinances() {
  return (
    <div className="lp-mini lp-mini--finances" aria-hidden="true">
      <div className="lp-mini-kpi">
        <div className="lp-mini-kpi-label">Cobrado (Mes)</div>
        <div className="lp-mini-kpi-value">$18,240</div>
        <div className="lp-mini-kpi-meta">Abril</div>
      </div>
      <div className="lp-mini-kpi">
        <div className="lp-mini-kpi-label">No Cobrado</div>
        <div className="lp-mini-kpi-value lp-mini-kpi-value--red">$2,450</div>
        <div className="lp-mini-kpi-meta">3 con saldo</div>
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
              <MiniSessions />
              <div className="lp-feature-label">Tu día, claro.</div>
            </article>
            <article className="lp-feature-v2" data-reveal style={{ "--i": 1 }}>
              <MiniPatients />
              <div className="lp-feature-label">Cada paciente, una vista.</div>
            </article>
            <article className="lp-feature-v2" data-reveal style={{ "--i": 2 }}>
              <MiniFinances />
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

      {/* 4. Footer */}
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
