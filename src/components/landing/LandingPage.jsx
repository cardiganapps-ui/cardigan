import { useEffect, useMemo, useRef } from "react";
import { LogoIcon } from "../LogoMark";
import { ProductPreview } from "./ProductPreview";
import { MiniSessions, MiniPatients, MiniFinances } from "./MiniMocks";
import { getLandingMock } from "./landingMock";
import {
  IconCalendar, IconUsers, IconLock, IconBell, IconSmartphone, IconDownload,
} from "../Icons";

/* ── Shared primitives ───────────────────────────────────────────── */
function CTAButton({ variant = "primary", onClick, children, type = "button" }) {
  return (
    <button type={type} className={`lp-btn lp-btn--${variant}`} onClick={onClick}>
      {children}
    </button>
  );
}

/* Feature deck — six cards in a 3x2 grid (mobile: stacks). Each card
   is a mini-pitch: icon + title + 1-line body. Reuses the existing
   Icon* family so the visual language matches the in-app surfaces. */
const FEATURES = [
  {
    Icon: IconCalendar,
    title: "Tu agenda, en automático.",
    body: "Repite cada semana, sola.",
  },
  {
    Icon: IconUsers,
    title: "Cada cliente, un toque.",
    body: "Notas, pagos, archivos. Ahí mismo.",
  },
  {
    Icon: IconLock,
    title: "Tus notas, blindadas.",
    body: "Cifradas. Solo tú las lees.",
  },
  {
    Icon: IconBell,
    title: "Nadie olvida la cita.",
    body: "Recordatorios push, en automático.",
  },
  {
    Icon: IconDownload,
    title: "Tus datos, tuyos.",
    body: "Exporta cuando quieras. Sin candados.",
  },
  {
    Icon: IconSmartphone,
    title: "App sin App Store.",
    body: "Instálala desde tu navegador.",
  },
];

const FAQS = [
  {
    q: "¿Funciona en mi celular?",
    a: "Sí. Cardigan está pensada para usarse desde el celular y se instala como app desde Safari o Chrome. También funciona en computadora.",
  },
  {
    q: "¿Mis datos están seguros?",
    a: "Tus notas clínicas viajan cifradas extremo a extremo — solo tú las puedes leer. Tus datos están en servidores en EE.UU. con respaldos diarios y cumplimos con LFPDPPP.",
  },
  {
    q: "¿Puedo exportar mis pacientes?",
    a: "Cuando quieras y sin pedir permiso. Descarga un JSON con todo: pacientes, sesiones, pagos y notas. Tus datos siempre son tuyos.",
  },
  {
    q: "¿Hay contrato o permanencia?",
    a: "Ningún contrato. Pagas mes a mes (o anual con descuento) y cancelas en un toque desde la app cuando ya no la necesites.",
  },
  {
    q: "¿Tengo que enseñarle a usarla a mis pacientes?",
    a: "No. Cardigan es solo para ti. Tus pacientes nunca entran a la app — solo tú agendas y los recordatorios llegan al horario que elijas.",
  },
  {
    q: "¿Y si decido cancelar?",
    a: "Tu cuenta se queda intacta. Puedes seguir leyendo todo en modo lectura, exportar tus datos, y reactivar cuando quieras.",
  },
];

/* ── Landing page ────────────────────────────────────────────────── */
export function LandingPage({ onPrimary, onSecondary, onLogin }) {
  const rootRef = useRef(null);
  // Mock data is locked to the psychologist demo seed. We tried a
  // tab control that swapped seeds per profession, but visitors
  // (correctly) noted the surfaces all look the same — the patient
  // names change but the layout doesn't, so the switch added no
  // signal. Reverting to a single fixed seed keeps the page lean.
  const mock = useMemo(() => getLandingMock("psychologist"), []);

  // Sticky-nav style change after the hero scrolls past. Cheap
  // IntersectionObserver + class toggle on the nav.
  const navRef = useRef(null);
  const heroRef = useRef(null);
  useEffect(() => {
    const nav = navRef.current;
    const hero = heroRef.current;
    if (!nav || !hero) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        nav.classList.toggle("lp-nav--scrolled", !entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "-60px 0px 0px 0px" }
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

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
      <nav ref={navRef} className="lp-nav" aria-label="Primary">
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
      <section ref={heroRef} id="hero" className="lp-section lp-hero" aria-labelledby="lp-hero-title">
        <div className="lp-glow" aria-hidden="true" />
        <div className="lp-container lp-hero-grid">
          <div className="lp-hero-copy">
            <h1 id="lp-hero-title" className="lp-hero-title">
              Tu práctica, <span className="lp-accent">en orden.</span>
            </h1>
            <p className="lp-hero-sub">
              Una sola app. Para todo.
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
            <ProductPreview mock={mock} />
          </div>
        </div>
      </section>

      {/* 2. Trust strip — what visitors need to know before scrolling. */}
      <section className="lp-section lp-trust" aria-label="Confianza">
        <div className="lp-container lp-trust-row">
          <div className="lp-trust-pill" data-reveal style={{ "--i": 0 }}>
            <IconLock size={16} />
            <span>Notas blindadas</span>
          </div>
          <div className="lp-trust-pill" data-reveal style={{ "--i": 1 }}>
            <IconDownload size={16} />
            <span>Tus datos, tuyos</span>
          </div>
          <div className="lp-trust-pill" data-reveal style={{ "--i": 2 }}>
            <IconCalendar size={16} />
            <span>Cero contratos</span>
          </div>
        </div>
      </section>

      {/* 3. Feature deck — 6 cards, icon + title + body. */}
      <section id="features" className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Lo necesario. Nada más.</h2>
          <p className="lp-section-sub">
            Hecho en México, para ti.
          </p>
          <div className="lp-feature-deck">
            {FEATURES.map((f, i) => (
              <article key={f.title} className="lp-feature-card" data-reveal style={{ "--i": i }}>
                <div className="lp-feature-icon">
                  <f.Icon size={20} />
                </div>
                <h3 className="lp-feature-title">{f.title}</h3>
                <p className="lp-feature-body">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Mockup strip — three coherent slices of the live app,
          all driven by the same demo seed. Switches with the profession
          chips above. */}
      <section className="lp-section">
        <div className="lp-container">
          <div className="lp-features">
            <article className="lp-feature-v2" data-reveal style={{ "--i": 0 }}>
              <MiniSessions mock={mock} />
              <div className="lp-feature-label">Tu día. De un vistazo.</div>
            </article>
            <article className="lp-feature-v2" data-reveal style={{ "--i": 1 }}>
              <MiniPatients mock={mock} />
              <div className="lp-feature-label">Cada cliente, un toque.</div>
            </article>
            <article className="lp-feature-v2" data-reveal style={{ "--i": 2 }}>
              <MiniFinances mock={mock} />
              <div className="lp-feature-label">Cobras lo que toca.</div>
            </article>
          </div>
        </div>
      </section>

      {/* 5. Cómo empezar — the path to utilization */}
      <section id="start" className="lp-section lp-start">
        <div className="lp-container">
          <h2 className="lp-section-title">Listo en 3 pasos.</h2>
          <ol className="lp-steps">
            <li className="lp-step" data-reveal style={{ "--i": 0 }}>
              <span className="lp-step-num">1</span>
              <span className="lp-step-label">Crea tu cuenta</span>
            </li>
            <li className="lp-step" data-reveal style={{ "--i": 1 }}>
              <span className="lp-step-num">2</span>
              <span className="lp-step-label">Agrega tu primer cliente</span>
            </li>
            <li className="lp-step" data-reveal style={{ "--i": 2 }}>
              <span className="lp-step-num">3</span>
              <span className="lp-step-label">Agenda tu primera cita</span>
            </li>
          </ol>
        </div>
      </section>

      {/* 6. Pricing teaser. */}
      <section id="pricing" className="lp-section lp-pricing" aria-labelledby="lp-pricing-title">
        <div className="lp-container lp-pricing-card" data-reveal style={{ "--i": 0 }}>
          <div className="lp-pricing-eyebrow">Cardigan Pro</div>
          <h2 id="lp-pricing-title" className="lp-pricing-title">
            <span className="lp-pricing-amount">$299</span>
            <span className="lp-pricing-period"> MXN al mes</span>
          </h2>
          <p className="lp-pricing-sub">
            O $2,990 al año — ahorras 17%.
          </p>
          <ul className="lp-pricing-features">
            <li>30 días gratis. Sin tarjeta.</li>
            <li>Todo, desde el día uno.</li>
            <li>Cancela en un toque.</li>
          </ul>
          <div className="lp-pricing-ctas">
            <CTAButton variant="primary" onClick={onPrimary}>
              Empezar gratis
            </CTAButton>
            <CTAButton variant="secondary" onClick={onSecondary}>
              Probar demo
            </CTAButton>
          </div>
        </div>
      </section>

      {/* 7. FAQ — native disclosure widget, no JS state needed. */}
      <section id="faq" className="lp-section lp-faq" aria-labelledby="lp-faq-title">
        <div className="lp-container">
          <h2 id="lp-faq-title" className="lp-section-title">Preguntas frecuentes</h2>
          <div className="lp-faq-list">
            {FAQS.map((f, i) => (
              <details key={i} className="lp-faq-item" data-reveal style={{ "--i": i }}>
                <summary className="lp-faq-q">
                  <span>{f.q}</span>
                  <span className="lp-faq-chevron" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </summary>
                <p className="lp-faq-a">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <LogoIcon size={14} color="var(--charcoal-xl)" />
            <span>cardigan</span>
            <span className="lp-footer-copy">© 2026</span>
          </div>
          <div className="lp-footer-cols">
            <div className="lp-footer-col">
              <div className="lp-footer-col-title">Producto</div>
              <a href="#hero" className="lp-footer-link">Inicio</a>
              <a href="#features" className="lp-footer-link">Funciones</a>
              <a href="#pricing" className="lp-footer-link">Precios</a>
              <button type="button" className="lp-footer-link lp-footer-link--btn" onClick={onSecondary}>
                Probar demo
              </button>
            </div>
            <div className="lp-footer-col">
              <div className="lp-footer-col-title">Legal</div>
              <a href="#privacy" className="lp-footer-link">Privacidad</a>
            </div>
            <div className="lp-footer-col">
              <div className="lp-footer-col-title">Soporte</div>
              <a href="mailto:privacy@cardigan.mx" className="lp-footer-link">privacy@cardigan.mx</a>
            </div>
          </div>
          <div className="lp-footer-meta">Hecho en México</div>
        </div>
      </footer>
    </div>
  );
}
