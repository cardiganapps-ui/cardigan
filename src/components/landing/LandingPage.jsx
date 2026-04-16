import { LogoIcon } from "../LogoMark";
import { ProductPreview } from "./ProductPreview";

/* ── Shared primitives ──────────────────────────────────────────────
   Kept co-located because they're only used on the landing page.
   Section: max-width container + consistent vertical rhythm.
   CTAButton: rounded, medium-weight, two variants.
   FeatureCard: title + description card used in the Solution grid.
*/
function Section({ id, children, dark = false, ariaLabelledBy }) {
  return (
    <section
      id={id}
      className={`lp-section${dark ? " lp-section--dark" : ""}`}
      aria-labelledby={ariaLabelledBy}
    >
      <div className="lp-container">{children}</div>
    </section>
  );
}

function CTAButton({ variant = "primary", onClick, children, type = "button" }) {
  return (
    <button
      type={type}
      className={`lp-btn lp-btn--${variant}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FeatureCard({ title, desc }) {
  return (
    <div className="lp-feature">
      <div className="lp-feature-title">{title}</div>
      <div className="lp-feature-desc">{desc}</div>
    </div>
  );
}

/* ── Landing page ──────────────────────────────────────────────────── */
export function LandingPage({ onPrimary, onSecondary, onLogin, onShowTerms }) {
  return (
    <div className="lp-root">
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

      {/* 1. Hero */}
      <Section id="hero" ariaLabelledBy="lp-hero-title">
        <h1 id="lp-hero-title" className="lp-hero-title">
          Gestiona tu consultorio sin complicaciones.
        </h1>
        <p className="lp-hero-sub">
          Citas, pacientes y cobros — todo en un solo lugar.
          Sin capacitación. Sin complejidad. Solo lo que necesitas.
        </p>
        <div className="lp-hero-ctas">
          <CTAButton variant="primary" onClick={onPrimary}>
            Comenzar gratis
          </CTAButton>
          <CTAButton variant="secondary" onClick={onSecondary}>
            Ver cómo funciona
          </CTAButton>
        </div>
      </Section>

      {/* 2. Problem */}
      <Section id="problem" ariaLabelledBy="lp-problem-title">
        <h2 id="lp-problem-title" className="lp-section-title">
          La mayoría de las herramientas complican lo simple.
        </h2>
        <div className="lp-body">
          <p>
            Terminas haciendo malabares entre calendarios, hojas de cálculo,
            links de pago y notas — tratando de mantener todo sincronizado.
          </p>
          <p className="lp-body-emphasis">Funciona… hasta que deja de funcionar.</p>
          <p>
            Cobros olvidados. Citas duplicadas. Sin una vista clara de tu
            negocio.
          </p>
        </div>
      </Section>

      {/* 3. Solution */}
      <Section id="solution" ariaLabelledBy="lp-solution-title">
        <h2 id="lp-solution-title" className="lp-section-title">
          Cardigan mantiene todo en un solo lugar.
        </h2>
        <p className="lp-section-sub">
          Hecho para consultorios que no necesitan complejidad — solo control.
        </p>
        <div className="lp-features">
          <FeatureCard
            title="Tu día, claramente organizado"
            desc="Revisa tu agenda, disponibilidad y próximas sesiones de un vistazo. Sin traslapes. Sin confusión."
          />
          <FeatureCard
            title="Cada paciente en una sola vista"
            desc="Accede al historial, notas y pagos al instante. Sin buscar entre mensajes o archivos."
          />
          <FeatureCard
            title="Sabe exactamente cómo vas"
            desc="Lleva el control de pagos, saldos pendientes e ingresos en tiempo real. Sin hojas de cálculo."
          />
        </div>
      </Section>

      {/* 4. Differentiation */}
      <Section id="differentiation" ariaLabelledBy="lp-diff-title">
        <h2 id="lp-diff-title" className="lp-section-title">
          Todo lo que necesitas. Nada que no.
        </h2>
        <ul className="lp-diff-list">
          <li>Configúralo en minutos</li>
          <li>Sin capacitación</li>
          <li>Funciona desde el día uno</li>
          <li>Diseñado para ser rápido y claro</li>
        </ul>
      </Section>

      {/* 5. Use cases */}
      <Section id="use-cases" ariaLabelledBy="lp-usecases-title">
        <h2 id="lp-usecases-title" className="lp-section-title">
          Hecho para profesionales como tú
        </h2>
        <ul className="lp-usecase-list">
          <li>Terapeutas</li>
          <li>Consultores</li>
          <li>Coaches</li>
          <li>Clínicas pequeñas</li>
          <li>Profesionistas independientes</li>
        </ul>
      </Section>

      {/* 6. Product preview */}
      <Section id="preview" ariaLabelledBy="lp-preview-title">
        <h2 id="lp-preview-title" className="lp-section-title">
          Simple por diseño
        </h2>
        <p className="lp-section-sub">
          Un tablero limpio que muestra justo lo que importa — tu agenda,
          tus pacientes y tus ingresos.
        </p>
        <ProductPreview />
      </Section>

      {/* 7. Final CTA */}
      <Section id="final-cta" ariaLabelledBy="lp-final-title" dark>
        <h2 id="lp-final-title" className="lp-final-title">
          Toma el control de tu consultorio.
        </h2>
        <p className="lp-final-sub">Sin caos. Sin desorden. Solo claridad.</p>
        <div className="lp-hero-ctas">
          <CTAButton variant="primary" onClick={onPrimary}>
            Comenzar gratis
          </CTAButton>
        </div>
      </Section>

      {/* 8. Footer */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <LogoIcon size={14} color="var(--charcoal-xl)" />
            <span>cardigan</span>
          </div>
          <div className="lp-footer-tag">Gestión de consultorio, simplificada.</div>
          <button type="button" className="lp-footer-link" onClick={onShowTerms}>
            Términos y Condiciones
          </button>
        </div>
      </footer>
    </div>
  );
}
