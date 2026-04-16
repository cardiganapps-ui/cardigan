import { LogoIcon } from "../LogoMark";

/* ── Términos y Condiciones ─────────────────────────────────────────
   Página legal mostrada desde el footer de la landing. Redactada con
   base en la legislación mexicana aplicable a un SaaS dirigido a
   profesionales de la salud mental:
     - Ley Federal de Protección al Consumidor (LFPC)
     - Ley Federal de Protección de Datos Personales en Posesión
       de los Particulares (LFPDPPP) y su Reglamento
     - Código de Comercio (Título Segundo, Del Comercio Electrónico)
     - Código Civil Federal
     - Ley Federal del Derecho de Autor (LFDA)
     - NOM-004-SSA3-2012 y NOM-024-SSA3-2012 (expediente clínico)
   Los datos fiscales y de contacto del Titular deben completarse antes
   de publicar formalmente. */
export function TermsPage({ onBack }) {
  const lastUpdate = "16 de abril de 2026";

  return (
    <div className="lp-root">
      <nav className="lp-nav" aria-label="Primary">
        <div className="lp-container lp-nav-inner">
          <button
            type="button"
            className="lp-nav-brand"
            onClick={onBack}
            style={{ background: "none", border: "none", cursor: "pointer" }}
            aria-label="Volver al inicio"
          >
            <LogoIcon size={22} color="var(--charcoal)" />
            <span>cardigan</span>
          </button>
          <div className="lp-nav-actions">
            <button type="button" className="lp-nav-link" onClick={onBack}>
              Volver
            </button>
          </div>
        </div>
      </nav>

      <section className="lp-section" aria-labelledby="terms-title">
        <div className="lp-container lp-legal">
          <h1 id="terms-title" className="lp-legal-title">
            Términos y Condiciones de Uso
          </h1>
          <p className="lp-legal-meta">
            Última actualización: {lastUpdate}
          </p>

          <p className="lp-legal-p">
            Los presentes Términos y Condiciones (en adelante, los
            <strong> &ldquo;Términos&rdquo;</strong>) regulan el acceso y uso de
            la plataforma digital <strong>Cardigan</strong> (en adelante, la
            <strong> &ldquo;Plataforma&rdquo;</strong>), puesta a disposición de
            los usuarios a través del sitio{" "}
            <span className="lp-legal-mono">https://cardigan-fawn.vercel.app</span>{" "}
            y sus subdominios. Al registrarse, crear una cuenta o utilizar la
            Plataforma, el Usuario acepta expresamente estos Términos en
            términos del artículo 1803 del Código Civil Federal y del Título
            Segundo del Código de Comercio. Si el Usuario no está conforme con
            alguno de los términos, deberá abstenerse de utilizar la
            Plataforma.
          </p>

          <h2 className="lp-legal-h2">1. Identificación del Titular</h2>
          <p className="lp-legal-p">
            La Plataforma es operada por el titular de Cardigan (en adelante,
            el <strong>&ldquo;Titular&rdquo;</strong>), con domicilio en los
            Estados Unidos Mexicanos. Los datos fiscales y de contacto
            específicos del Titular, así como el Aviso de Privacidad integral,
            estarán disponibles a solicitud del Usuario al correo de contacto
            indicado en la sección 17 de estos Términos.
          </p>

          <h2 className="lp-legal-h2">2. Definiciones</h2>
          <ul className="lp-legal-list">
            <li>
              <strong>Usuario:</strong> persona física con capacidad legal que
              crea una cuenta para administrar su consultorio.
            </li>
            <li>
              <strong>Paciente:</strong> persona cuyos datos personales son
              ingresados por el Usuario en la Plataforma con fines de gestión
              clínica y administrativa.
            </li>
            <li>
              <strong>Contenido del Usuario:</strong> cualquier información,
              nota, documento o dato que el Usuario cargue o genere dentro de
              la Plataforma.
            </li>
            <li>
              <strong>Servicios:</strong> funcionalidades de agenda, gestión de
              pacientes, cobros, notas y almacenamiento de documentos
              ofrecidas por la Plataforma.
            </li>
          </ul>

          <h2 className="lp-legal-h2">3. Objeto</h2>
          <p className="lp-legal-p">
            La Plataforma es una herramienta de productividad dirigida a
            profesionales independientes del área de salud mental, consultoría
            y coaching, que permite organizar citas, dar seguimiento a
            pacientes, registrar pagos y almacenar notas y documentos. La
            Plataforma <strong>no presta servicios de salud</strong>, no emite
            diagnósticos, no sustituye el criterio profesional del Usuario y
            no es un sistema institucional de expediente clínico electrónico
            certificado conforme a la NOM-024-SSA3-2012.
          </p>

          <h2 className="lp-legal-h2">4. Registro y Cuenta</h2>
          <p className="lp-legal-p">
            Para acceder a los Servicios, el Usuario deberá crear una cuenta
            proporcionando información veraz, exacta y actualizada. El Usuario
            es el único responsable de mantener la confidencialidad de su
            contraseña y de toda la actividad que ocurra bajo su cuenta. El
            Usuario deberá notificar inmediatamente al Titular cualquier uso no
            autorizado de su cuenta.
          </p>
          <p className="lp-legal-p">
            El Usuario manifiesta, bajo protesta de decir verdad, que es mayor
            de edad y cuenta con plena capacidad jurídica para obligarse en
            términos de los artículos 1798 y 1800 del Código Civil Federal.
          </p>

          <h2 className="lp-legal-h2">5. Uso permitido de la Plataforma</h2>
          <p className="lp-legal-p">
            El Usuario se obliga a utilizar la Plataforma conforme a la ley,
            la moral, las buenas costumbres y el orden público. Queda
            estrictamente prohibido:
          </p>
          <ul className="lp-legal-list">
            <li>
              Utilizar la Plataforma para fines ilícitos, fraudulentos o
              contrarios a lo establecido en estos Términos.
            </li>
            <li>
              Intentar acceder sin autorización a cuentas de otros Usuarios o
              a los sistemas del Titular.
            </li>
            <li>
              Introducir código malicioso, realizar ingeniería inversa,
              descompilar o intentar vulnerar las medidas de seguridad.
            </li>
            <li>
              Usar la Plataforma para almacenar contenido que infrinja derechos
              de terceros o que constituya publicidad no autorizada.
            </li>
            <li>
              Revender, sublicenciar o comercializar el acceso a la Plataforma
              sin autorización escrita del Titular.
            </li>
          </ul>

          <h2 className="lp-legal-h2">
            6. Responsabilidad del Usuario respecto a datos de Pacientes
          </h2>
          <p className="lp-legal-p">
            El Usuario reconoce que, conforme a la{" "}
            <strong>
              Ley Federal de Protección de Datos Personales en Posesión de los
              Particulares (LFPDPPP)
            </strong>
            , es el <strong>Responsable</strong> del tratamiento de los datos
            personales de sus Pacientes. En consecuencia, el Usuario se obliga
            a:
          </p>
          <ul className="lp-legal-list">
            <li>
              Contar con el consentimiento informado del Paciente (o de quien
              ejerza la patria potestad o tutela en el caso de menores de edad)
              para el tratamiento de sus datos, incluidos los datos personales
              sensibles en términos del artículo 9 de la LFPDPPP.
            </li>
            <li>
              Poner a disposición de sus Pacientes un Aviso de Privacidad que
              cumpla con los requisitos de los artículos 15, 16 y 17 de la
              LFPDPPP.
            </li>
            <li>
              Atender directamente las solicitudes de Acceso, Rectificación,
              Cancelación y Oposición (ARCO) que presenten sus Pacientes.
            </li>
            <li>
              Cumplir con los deberes de confidencialidad, secreto profesional
              y, cuando corresponda, con la NOM-004-SSA3-2012 relativa al
              expediente clínico.
            </li>
          </ul>
          <p className="lp-legal-p">
            En la relación con los datos de Pacientes, el Titular de la
            Plataforma actúa únicamente como{" "}
            <strong>Encargado</strong> del tratamiento en términos del artículo
            50 del Reglamento de la LFPDPPP, procesando dichos datos
            exclusivamente conforme a las instrucciones del Usuario y para
            efectos de prestar los Servicios.
          </p>

          <h2 className="lp-legal-h2">7. Aviso de Privacidad del Usuario</h2>
          <p className="lp-legal-p">
            El tratamiento de los datos personales del Usuario (nombre, correo
            electrónico, datos de facturación y datos de uso) se rige por el
            Aviso de Privacidad del Titular, que forma parte integrante de
            estos Términos y estará disponible en la Plataforma. El Usuario
            podrá ejercer sus derechos ARCO a través del correo de contacto
            indicado en la sección 17.
          </p>

          <h2 className="lp-legal-h2">8. Planes, Pagos y Facturación</h2>
          <p className="lp-legal-p">
            La Plataforma puede ofrecer un plan gratuito y planes de
            suscripción de pago. Los precios, características y forma de pago
            de cada plan se informarán al Usuario antes de la contratación, en
            pesos mexicanos (MXN) e incluyendo el Impuesto al Valor Agregado
            (IVA) cuando resulte aplicable. La contratación de un plan de pago
            implica la renovación automática por periodos iguales, salvo
            cancelación previa por parte del Usuario desde la configuración de
            su cuenta. A solicitud expresa del Usuario, y con los datos
            fiscales correspondientes, el Titular emitirá el Comprobante
            Fiscal Digital por Internet (CFDI) conforme a las disposiciones
            del Código Fiscal de la Federación y de las reglas de la
            Resolución Miscelánea Fiscal vigente.
          </p>

          <h2 className="lp-legal-h2">9. Derecho de cancelación</h2>
          <p className="lp-legal-p">
            De conformidad con el artículo 56 de la Ley Federal de Protección
            al Consumidor, cuando la contratación se celebre vía electrónica,
            el Usuario contará con <strong>cinco días hábiles</strong> contados
            a partir del pago para revocar su consentimiento, siempre que no
            haya hecho uso intensivo de los Servicios. La cancelación surtirá
            efectos al cierre del periodo de facturación en curso, salvo lo
            previsto por el citado artículo 56.
          </p>

          <h2 className="lp-legal-h2">10. Propiedad Intelectual</h2>
          <p className="lp-legal-p">
            Todos los derechos de propiedad intelectual sobre la Plataforma,
            incluyendo el software, diseños, marcas, logotipos, bases de datos
            y documentación, son titularidad del Titular o de sus licenciantes
            y están protegidos por la Ley Federal del Derecho de Autor, la Ley
            Federal de Protección a la Propiedad Industrial y los tratados
            internacionales aplicables. Por estos Términos se otorga al Usuario
            una licencia limitada, no exclusiva, revocable e intransferible
            para usar la Plataforma con fines legítimos conforme a estos
            Términos.
          </p>
          <p className="lp-legal-p">
            El Contenido del Usuario continúa siendo de su exclusiva
            titularidad. El Usuario otorga al Titular una licencia limitada
            para almacenar, reproducir y procesar dicho Contenido con el único
            fin de prestar los Servicios.
          </p>

          <h2 className="lp-legal-h2">11. Disponibilidad del Servicio</h2>
          <p className="lp-legal-p">
            El Titular realizará esfuerzos razonables para mantener la
            Plataforma disponible de forma continua; sin embargo, no garantiza
            que el servicio sea ininterrumpido, libre de errores o de
            vulnerabilidades. El Titular podrá suspender temporalmente los
            Servicios por mantenimiento, actualizaciones o causas de fuerza
            mayor, sin que ello genere responsabilidad alguna.
          </p>

          <h2 className="lp-legal-h2">12. Limitación de Responsabilidad</h2>
          <p className="lp-legal-p">
            En la máxima medida permitida por la legislación aplicable, el
            Titular <strong>no será responsable</strong> por daños indirectos,
            incidentales, especiales, punitivos o consecuenciales, incluyendo
            pérdida de información, de ingresos o de oportunidades de negocio,
            derivados del uso o imposibilidad de uso de la Plataforma. En todo
            caso, la responsabilidad total acumulada del Titular frente al
            Usuario no excederá del monto efectivamente pagado por el Usuario
            al Titular en los doce (12) meses anteriores al hecho que originó
            la reclamación.
          </p>
          <p className="lp-legal-p">
            El Usuario reconoce que la Plataforma es una herramienta auxiliar
            y que es responsable de respaldar su información y de verificar la
            exactitud de los registros antes de utilizarlos con fines
            clínicos, fiscales o contables.
          </p>

          <h2 className="lp-legal-h2">13. Indemnización</h2>
          <p className="lp-legal-p">
            El Usuario se obliga a sacar en paz y a salvo al Titular, sus
            empleados, proveedores y afiliados de cualquier reclamación,
            demanda, procedimiento, daño o sanción (incluidos honorarios
            razonables de abogados) derivados de: (i) el incumplimiento de
            estos Términos por parte del Usuario; (ii) la violación de derechos
            de terceros, incluidos los Pacientes; o (iii) el uso indebido de
            la Plataforma.
          </p>

          <h2 className="lp-legal-h2">14. Suspensión y Terminación</h2>
          <p className="lp-legal-p">
            El Titular podrá suspender o cancelar el acceso a la Plataforma,
            previa notificación cuando sea razonablemente posible, si el
            Usuario incumple estos Términos o utiliza la Plataforma con fines
            ilícitos. El Usuario podrá cancelar su cuenta en cualquier momento
            desde la configuración. Una vez cancelada la cuenta, el Contenido
            del Usuario podrá conservarse por un periodo razonable para
            cumplir obligaciones legales y, posteriormente, será eliminado o
            anonimizado.
          </p>

          <h2 className="lp-legal-h2">15. Modificaciones a los Términos</h2>
          <p className="lp-legal-p">
            El Titular podrá modificar los presentes Términos en cualquier
            momento, notificando al Usuario a través de la Plataforma o por
            correo electrónico, con al menos quince (15) días naturales de
            anticipación a su entrada en vigor. El uso continuado de la
            Plataforma con posterioridad a la entrada en vigor de las
            modificaciones se entenderá como aceptación de las mismas.
          </p>

          <h2 className="lp-legal-h2">16. Caso Fortuito y Fuerza Mayor</h2>
          <p className="lp-legal-p">
            Ninguna de las partes será responsable por el incumplimiento de
            sus obligaciones cuando éste se deba a caso fortuito o fuerza
            mayor, incluyendo, de manera enunciativa, fallas generalizadas de
            Internet, cortes de energía, eventos climatológicos, actos de
            autoridad o pandemias.
          </p>

          <h2 className="lp-legal-h2">17. Contacto</h2>
          <p className="lp-legal-p">
            Para cualquier aclaración, queja o solicitud relacionada con estos
            Términos, el Aviso de Privacidad o el ejercicio de derechos ARCO,
            el Usuario podrá escribir al correo electrónico de contacto
            indicado en la Plataforma.
          </p>

          <h2 className="lp-legal-h2">
            18. Legislación aplicable y Jurisdicción
          </h2>
          <p className="lp-legal-p">
            Estos Términos se rigen por la legislación federal vigente en los
            Estados Unidos Mexicanos. Para todo lo relativo a su
            interpretación, cumplimiento y ejecución, las partes se someten
            expresamente a la competencia de la{" "}
            <strong>
              Procuraduría Federal del Consumidor (PROFECO)
            </strong>{" "}
            en la vía administrativa y a la jurisdicción de los tribunales
            competentes de la <strong>Ciudad de México</strong>, renunciando a
            cualquier otro fuero que pudiera corresponderles por razón de sus
            domicilios presentes o futuros.
          </p>

          <div className="lp-legal-footer">
            <button type="button" className="lp-btn lp-btn--secondary" onClick={onBack}>
              Volver al inicio
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
