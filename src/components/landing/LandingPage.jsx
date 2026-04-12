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
export function LandingPage({ onPrimary, onSecondary, onLogin }) {
  return (
    <div className="lp-root">
      {/* Nav */}
      <nav className="lp-nav" aria-label="Primary">
        <div className="lp-container lp-nav-inner">
          <a href="#hero" className="lp-nav-brand" aria-label="Cardigan home">
            <LogoIcon size={22} color="var(--charcoal)" />
            <span>cardigan</span>
          </a>
          <div className="lp-nav-actions">
            <button type="button" className="lp-nav-link" onClick={onLogin}>
              Sign in
            </button>
            <CTAButton variant="primary" onClick={onPrimary}>
              Get early access
            </CTAButton>
          </div>
        </div>
      </nav>

      {/* 1. Hero */}
      <Section id="hero" ariaLabelledBy="lp-hero-title">
        <h1 id="lp-hero-title" className="lp-hero-title">
          Run your practice without the chaos.
        </h1>
        <p className="lp-hero-sub">
          Appointments, clients, and payments — all in one simple system.
          No training. No bloat. Just what you need to operate.
        </p>
        <div className="lp-hero-ctas">
          <CTAButton variant="primary" onClick={onPrimary}>
            Get early access
          </CTAButton>
          <CTAButton variant="secondary" onClick={onSecondary}>
            See how it works
          </CTAButton>
        </div>
      </Section>

      {/* 2. Problem */}
      <Section id="problem" ariaLabelledBy="lp-problem-title">
        <h2 id="lp-problem-title" className="lp-section-title">
          Most tools make simple things harder.
        </h2>
        <div className="lp-body">
          <p>
            You end up juggling calendars, spreadsheets, payment links, and
            notes — trying to keep everything in sync.
          </p>
          <p className="lp-body-emphasis">It works… until it doesn’t.</p>
          <p>
            Missed payments. Double bookings. No clear picture of your
            business.
          </p>
        </div>
      </Section>

      {/* 3. Solution */}
      <Section id="solution" ariaLabelledBy="lp-solution-title">
        <h2 id="lp-solution-title" className="lp-section-title">
          Cardigan keeps everything in one place.
        </h2>
        <p className="lp-section-sub">
          Built for small practices that don’t need complexity — just control.
        </p>
        <div className="lp-features">
          <FeatureCard
            title="Your day, clearly organized"
            desc="See your schedule, availability, and upcoming sessions at a glance. No overlaps. No confusion."
          />
          <FeatureCard
            title="Every client in one view"
            desc="Access history, notes, and payments instantly. No digging through messages or files."
          />
          <FeatureCard
            title="Know exactly where you stand"
            desc="Track payments, pending balances, and revenue in real time. No spreadsheets required."
          />
        </div>
      </Section>

      {/* 4. Differentiation */}
      <Section id="differentiation" ariaLabelledBy="lp-diff-title">
        <h2 id="lp-diff-title" className="lp-section-title">
          Everything you need. Nothing you don’t.
        </h2>
        <ul className="lp-diff-list">
          <li>Set up in minutes</li>
          <li>No training required</li>
          <li>Works from day one</li>
          <li>Built for speed and clarity</li>
        </ul>
      </Section>

      {/* 5. Use cases */}
      <Section id="use-cases" ariaLabelledBy="lp-usecases-title">
        <h2 id="lp-usecases-title" className="lp-section-title">
          Built for operators like you
        </h2>
        <ul className="lp-usecase-list">
          <li>Therapists</li>
          <li>Consultants</li>
          <li>Coaches</li>
          <li>Small clinics</li>
          <li>Independent professionals</li>
        </ul>
      </Section>

      {/* 6. Product preview */}
      <Section id="preview" ariaLabelledBy="lp-preview-title">
        <h2 id="lp-preview-title" className="lp-section-title">
          Simple by design
        </h2>
        <p className="lp-section-sub">
          A clean dashboard that shows exactly what matters — your schedule,
          your clients, and your cash flow.
        </p>
        <ProductPreview />
      </Section>

      {/* 7. Final CTA */}
      <Section id="final-cta" ariaLabelledBy="lp-final-title" dark>
        <h2 id="lp-final-title" className="lp-final-title">
          Take control of your practice.
        </h2>
        <p className="lp-final-sub">No chaos. No clutter. Just clarity.</p>
        <div className="lp-hero-ctas">
          <CTAButton variant="primary" onClick={onPrimary}>
            Get early access
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
          <div className="lp-footer-tag">Practice management, made simple.</div>
        </div>
      </footer>
    </div>
  );
}
