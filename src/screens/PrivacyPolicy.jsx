import { POLICY_SECTIONS, POLICY_PUBLISHED, POLICY_VERSION } from "../data/privacy";
import { useCardigan } from "../context/CardiganContext";

export function PrivacyPolicy() {
  const { navigate } = useCardigan();
  return (
    <div className="page">
      <div className="section" style={{ paddingTop: 16 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigate("settings")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingLeft: 0 }}
        >
          <span aria-hidden="true">←</span>
          <span>Ajustes</span>
        </button>
        <h1 style={{ fontFamily: "var(--font-d)", fontSize: "var(--text-xl)", fontWeight: 900, color: "var(--charcoal)", marginTop: 16, marginBottom: 6, letterSpacing: "-0.02em" }}>
          Aviso de privacidad
        </h1>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-xl)", marginBottom: 24 }}>
          Versión {POLICY_VERSION} · Publicado el {POLICY_PUBLISHED}
        </div>

        {POLICY_SECTIONS.map((s) => (
          <section key={s.title} style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "var(--font-d)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--charcoal)", marginBottom: 6 }}>
              {s.title}
            </h2>
            {s.body.split("\n\n").map((para, i) => (
              <p
                key={i}
                style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", lineHeight: 1.6, margin: i === 0 ? 0 : "10px 0 0" }}
              >
                {para}
              </p>
            ))}
          </section>
        ))}

        <div style={{ fontSize: 12, color: "var(--charcoal-xl)", marginTop: 32, marginBottom: 40 }}>
          Para solicitudes relacionadas con este aviso o el ejercicio de tus derechos ARCO,
          contáctanos en privacy@cardigan.mx.
        </div>
      </div>
    </div>
  );
}
