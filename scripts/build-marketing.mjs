#!/usr/bin/env node
/* Build static HTML marketing pages — runs once or whenever copy
   changes. Outputs:

     public/psicologos/index.html
     public/nutriologos/index.html
     public/entrenadores/index.html
     public/maestros-de-musica/index.html
     public/tutores/index.html
     public/blog/index.html
     public/blog/<slug>/index.html (one per ARTICLES entry)

   These are pure-HTML pages (no JS required to render the marketing
   copy) so Googlebot indexes them on the first request. The React SPA
   continues to live at `/` — Vercel serves files in /public first
   and falls back to index.html for unmatched routes, so adding these
   subdirectories doesn't disturb the SPA's catch-all behaviour.

   Usage:
     node scripts/build-marketing.mjs
*/

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = resolve(ROOT, "public");

/* ── Profession-specific copy ───────────────────────────────────── */
const PROFESSIONS = [
  {
    slug: "psicologos",
    label: "psicólogos",
    Label: "Psicólogos",
    client: "pacientes",
    clientS: "paciente",
    session: "sesiones",
    sessionS: "sesión",
    record: "expediente",
    rate: "Honorarios",
    title: "Software para psicólogos en México",
    titleShort: "Cardigan para psicólogos",
    description: "La app para psicólogos en México: agenda, expediente, pagos y notas cifradas — todo en un solo lugar. 30 días gratis, sin tarjeta.",
    heroH1: "Tu consultorio, en un solo lugar.",
    heroLead: "Cardigan reúne agenda, expediente, pagos y notas cifradas para psicólogos en México. Pensado para que dediques menos tiempo a la administración y más a tus pacientes.",
    features: [
      { icon: "lock",     h: "Notas cifradas de extremo a extremo", body: "Tus apuntes clínicos viajan cifrados con tu propia contraseña — ni siquiera nosotros podemos leerlos." },
      { icon: "calendar", h: "Agenda recurrente",                   body: "Sesiones semanales, quincenales o personalizadas. Cardigan extiende tu agenda solita y te avisa antes de cada cita." },
      { icon: "wallet",   h: "Honorarios sin esfuerzo",             body: "Cardigan calcula automáticamente lo que cada paciente debe en base a las sesiones tomadas y los pagos recibidos." },
      { icon: "doc",      h: "Expediente por paciente",             body: "Documentos, notas, evaluaciones y antecedentes — todo organizado en una sola ficha." },
      { icon: "bell",     h: "Recordatorios automáticos",           body: "Notificaciones push antes de cada sesión. Tú no faltas y tus pacientes tampoco." },
      { icon: "shield",   h: "Cumple LFPDPPP",                      body: "Cifrado en reposo + en tránsito, política de privacidad clara, exportación de datos a un toque." },
    ],
    faqs: [
      { q: "¿Mis notas están seguras?", a: "Sí. Las notas se cifran de extremo a extremo con una contraseña que solo tú conoces. Ni Cardigan ni nadie en nuestro equipo puede leerlas. Cumplimos con la LFPDPPP." },
      { q: "¿Funciona en mi celular?", a: "Sí. Cardigan funciona en iPhone, iPad y Android — se instala como una app desde tu navegador en 10 segundos. También tiene una versión completa para escritorio." },
      { q: "¿Puedo exportar a mis pacientes?", a: "Sí. Desde Ajustes → Privacidad puedes descargar todos tus datos en formato JSON. Sin candados — son tus datos." },
      { q: "¿Hay contrato?", a: "No. Es una suscripción mensual ($299 MXN) que puedes cancelar desde la app cuando quieras. Sin penalizaciones." },
      { q: "¿Qué pasa si decido cancelar?", a: "Tus datos se quedan intactos. Si vuelves al mes siguiente, todo sigue donde lo dejaste — pacientes, notas, sesiones, pagos." },
    ],
    keyword: "software psicólogos méxico",
  },
  {
    slug: "nutriologos",
    label: "nutriólogos",
    Label: "Nutriólogos",
    client: "pacientes",
    clientS: "paciente",
    session: "consultas",
    sessionS: "consulta",
    record: "historial",
    rate: "Honorarios",
    title: "Software para nutriólogos en México",
    titleShort: "Cardigan para nutriólogos",
    description: "La app para nutriólogos en México: agenda de consultas, importación de InBody, mediciones corporales, planes alimenticios y pagos — en un solo lugar. 30 días gratis.",
    heroH1: "Lleva el control de tus pacientes y consultas.",
    heroLead: "Cardigan reúne agenda, historial nutricional, importación de InBody, mediciones corporales y pagos para nutriólogos en México. Menos hojas sueltas, más tiempo con tus pacientes.",
    features: [
      { icon: "inbody",   h: "Importa tus InBody",                 body: "Sube el CSV o Excel de LookinBody y todas las mediciones — músculo esquelético, grasa visceral, ángulo de fase — aparecen en el historial del paciente con gráficas listas." },
      { icon: "scale",    h: "Mediciones corporales con gráficos", body: "Peso, % grasa, perímetros — guarda mediciones y visualiza el progreso de cada paciente con gráficos automáticos." },
      { icon: "calendar", h: "Agenda de consultas",                body: "Consultas recurrentes, recordatorios automáticos y vista de mes / semana / día. Cancela una cita y Cardigan reorganiza el resto." },
      { icon: "doc",      h: "Plan alimenticio en notas",          body: "Adjunta planes, antecedentes médicos, alergias y foto del último análisis a la ficha de cada paciente." },
      { icon: "wallet",   h: "Cobros y saldos al instante",        body: "Lleva el control de pagos por consulta o por paquete. Cardigan calcula automáticamente lo que cada paciente debe." },
      { icon: "bell",     h: "Recordatorios automáticos",          body: "Notificaciones push antes de cada consulta. Tu agenda se llena, no se vacía." },
      { icon: "shield",   h: "Cumple LFPDPPP",                     body: "Datos cifrados en reposo y en tránsito. Exportación de información de cada paciente con un toque." },
    ],
    faqs: [
      { q: "¿Puedo importar mis InBody?", a: "Sí. Exporta el archivo desde LookinBody en formato CSV o Excel (.xlsx), de cualquier modelo (270, 570, 770, 970), súbelo a Cardigan, revisa la lista y confirma. Las mediciones de músculo esquelético, grasa visceral, ángulo de fase y InBody Score aparecen en el historial del paciente con gráficas listas. Re-importar el mismo archivo es seguro: las mediciones repetidas se omiten automáticamente." },
      { q: "¿Puedo subir planes alimenticios y análisis?", a: "Sí. Sube PDFs, imágenes o Word a la ficha de cada paciente — quedan vinculados a su historial y se pueden consultar en cualquier momento." },
      { q: "¿Cardigan grafica el peso de mis pacientes?", a: "Sí. Captura las mediciones (peso, % grasa, músculo, perímetros) en cada consulta y verás el progreso en una gráfica automática, con deltas desde la primera medición. Si el paciente tiene escaneos InBody, la gráfica cambia entre métricas con un toque." },
      { q: "¿Funciona en mi celular?", a: "Sí. Se instala como app en iPhone, iPad y Android desde el navegador. También funciona perfecto en escritorio." },
      { q: "¿Hay contrato?", a: "No. $299 MXN al mes, cancelas cuando quieras. Sin penalizaciones." },
      { q: "¿Mis pacientes pueden ver su información?", a: "No. Cardigan es para ti — tus pacientes no tienen acceso. Si quieres compartirles algo, exportas el documento o se los envías por correo." },
    ],
    keyword: "software nutriólogos méxico",
  },
  {
    slug: "entrenadores",
    label: "entrenadores personales",
    Label: "Entrenadores Personales",
    client: "clientes",
    clientS: "cliente",
    session: "entrenamientos",
    sessionS: "entrenamiento",
    record: "historial",
    rate: "Tarifa",
    title: "App para entrenadores personales en México",
    titleShort: "Cardigan para entrenadores",
    description: "La app para entrenadores personales en México: agenda, mediciones corporales, planes y pagos de tus clientes — en un solo lugar. 30 días gratis.",
    heroH1: "Tus clientes, sus mediciones, tus pagos. Todo junto.",
    heroLead: "Cardigan reúne agenda, mediciones corporales con gráficos de progreso, y cobros para entrenadores personales en México. Menos administración, más tiempo entrenando.",
    features: [
      { icon: "scale",    h: "Mediciones con gráficos",       body: "Peso, % grasa, perímetros, fuerza máxima — registra mediciones y visualiza el progreso de cada cliente con gráficos automáticos." },
      { icon: "calendar", h: "Agenda recurrente",             body: "Sesiones de 3x/semana, paquetes mensuales o sesiones sueltas. Cardigan extiende tu agenda y te avisa antes de cada entrenamiento." },
      { icon: "wallet",   h: "Cobros por sesión o paquete",   body: "Lleva el control de pagos individuales o por paquete. Cardigan calcula automáticamente cuánto te deben." },
      { icon: "doc",      h: "Notas y rutinas por cliente",   body: "Guarda rutinas, antecedentes de lesiones, fotos de progreso — todo organizado en una sola ficha." },
      { icon: "bell",     h: "Recordatorios automáticos",     body: "Notificaciones push antes de cada sesión. Llegas a tiempo y tu cliente también." },
      { icon: "shield",   h: "Datos seguros",                 body: "Cifrado en reposo + tránsito. Exporta tu información cuando quieras, sin candados." },
    ],
    faqs: [
      { q: "¿Puedo registrar mediciones de cada cliente?", a: "Sí. Captura peso, % grasa, perímetros y fuerza en cada sesión. Cardigan grafica el progreso automáticamente y te dice cuánto ha cambiado desde la primera medición." },
      { q: "¿Manejo paquetes de varias sesiones?", a: "Sí. Puedes cobrar por sesión individual, por paquete (10 sesiones, 1 mes, etc.) o como suscripción mensual. Cardigan rastrea las sesiones consumidas vs. pagadas." },
      { q: "¿Funciona en el gimnasio sin internet?", a: "Sí. Cardigan guarda tu trabajo localmente y sincroniza cuando vuelves a tener señal." },
      { q: "¿Hay contrato?", a: "No. $299 MXN al mes, cancelas cuando quieras." },
      { q: "¿Es solo para entrenadores con consultorio?", a: "No. Cardigan funciona para entrenadores que trabajan a domicilio, en parques, en gimnasios o en línea — la modalidad de cada sesión se configura por separado." },
    ],
    keyword: "app entrenador personal méxico",
  },
  {
    slug: "maestros-de-musica",
    label: "maestros de música",
    Label: "Maestros de Música",
    client: "alumnos",
    clientS: "alumno",
    session: "clases",
    sessionS: "clase",
    record: "bitácora",
    rate: "Colegiatura",
    title: "App para maestros de música particulares",
    titleShort: "Cardigan para maestros de música",
    description: "La app para maestros de música particulares en México: agenda de clases, bitácoras por alumno, colegiaturas mensuales y comunicación con padres — en un solo lugar.",
    heroH1: "Tus alumnos, sus clases, sus colegiaturas.",
    heroLead: "Cardigan reúne agenda, bitácora por alumno, comunicación con padres y cobros mensuales para maestros de música particulares en México. Olvídate de la libreta y los recordatorios por WhatsApp.",
    features: [
      { icon: "calendar", h: "Calendario de clases",             body: "Clases semanales fijas, recordatorios automáticos y vista de mes / semana / día. Cardigan extiende tu agenda solita." },
      { icon: "doc",      h: "Bitácora por alumno",              body: "Lleva apuntes del avance de cada alumno: piezas trabajadas, dificultades, tareas para la próxima clase." },
      { icon: "wallet",   h: "Colegiatura mensual",              body: "Lleva el control de cobros por mes o por clase. Cardigan calcula cuánto te deben sin que tú hagas cuentas." },
      { icon: "bell",     h: "Recordatorios al padre o madre",   body: "Notificación antes de cada clase para evitar faltas — sobre todo cuando se trata de niños." },
      { icon: "doc",      h: "Notas y partituras",               body: "Adjunta partituras, audios o videos a la bitácora del alumno." },
      { icon: "shield",   h: "Datos seguros",                    body: "Cifrado en reposo + tránsito. Exporta tu información cuando quieras." },
    ],
    faqs: [
      { q: "¿Puedo cobrar colegiatura mensual?", a: "Sí. Cardigan permite tanto cobro por clase como colegiatura mensual. El balance de cada alumno se calcula automáticamente." },
      { q: "¿Cómo registro las faltas?", a: "Cuando el alumno no asiste, marcas la clase como cancelada (con o sin cobro). Cardigan ajusta el balance automáticamente." },
      { q: "¿Puedo guardar partituras o audios?", a: "Sí. Adjunta archivos (PDF, audio, video, imágenes) a la bitácora de cada alumno. Quedan organizados por fecha." },
      { q: "¿Los padres pueden ver el avance?", a: "No directamente — Cardigan es solo para ti. Pero puedes exportar la bitácora cuando quieras compartirla." },
      { q: "¿Hay contrato?", a: "No. $299 MXN al mes, cancelas cuando quieras." },
    ],
    keyword: "app maestros música particulares",
  },
  {
    slug: "tutores",
    label: "tutores y profesores particulares",
    Label: "Tutores y Profesores Particulares",
    client: "alumnos",
    clientS: "alumno",
    session: "clases",
    sessionS: "clase",
    record: "bitácora",
    rate: "Colegiatura",
    title: "App para tutores y profesores particulares",
    titleShort: "Cardigan para tutores",
    description: "La app para tutores y profesores particulares en México: agenda de clases, bitácora del avance, colegiaturas mensuales y comunicación con padres — en un solo lugar.",
    heroH1: "Tu agenda, tus alumnos, sus avances.",
    heroLead: "Cardigan reúne calendario de clases, bitácora del avance académico, comunicación con padres y colegiaturas para tutores y profesores particulares en México.",
    features: [
      { icon: "calendar", h: "Calendario de clases",             body: "Clases semanales recurrentes, recordatorios automáticos y vista de mes / semana / día." },
      { icon: "doc",      h: "Bitácora académica",               body: "Lleva apuntes del avance de cada alumno: temas vistos, dificultades, tareas pendientes." },
      { icon: "wallet",   h: "Colegiatura mensual o por clase",  body: "Lleva el control de cobros sin que tengas que hacer cuentas a fin de mes." },
      { icon: "bell",     h: "Recordatorios al padre o madre",   body: "Notificación antes de cada clase para evitar faltas." },
      { icon: "doc",      h: "Material por alumno",              body: "Adjunta exámenes, ejercicios y material de apoyo a la bitácora del alumno." },
      { icon: "shield",   h: "Datos seguros",                    body: "Cifrado en reposo + tránsito. Exporta tu información cuando quieras." },
    ],
    faqs: [
      { q: "¿Sirve para clases en línea o presenciales?", a: "Las dos. Cada clase tiene una modalidad (presencial, virtual, a domicilio) que configuras al agendar." },
      { q: "¿Puedo manejar varios alumnos al mismo tiempo?", a: "Sí. Cardigan no tiene límite de alumnos. Cada uno tiene su propia bitácora, calendario y balance." },
      { q: "¿Cómo cobro a los padres?", a: "Cardigan rastrea quién pagó y quién no. Tú decides el método (efectivo, transferencia, etc.) — la app solo lleva la cuenta." },
      { q: "¿Puedo subir material a la bitácora?", a: "Sí. Adjunta PDFs, exámenes, fotos de la pizarra — todo organizado por fecha y alumno." },
      { q: "¿Hay contrato?", a: "No. $299 MXN al mes, cancelas cuando quieras." },
    ],
    keyword: "app tutores profesores particulares",
  },
];

/* ── Blog articles ─────────────────────────────────────────────────
   Each article gets its own /blog/<slug>/index.html page. The body
   is plain HTML (paragraphs + h2 + ul) — kept minimal so SEO crawlers
   read the content easily. */
const ARTICLES = [
  {
    slug: "facturar-como-psicologo-independiente-mexico",
    title: "Cómo facturar como psicólogo independiente en México",
    description: "Guía paso a paso para facturar tus consultas como psicólogo independiente en México: régimen RESICO, CFDI, claves SAT y consejos prácticos.",
    date: "2026-04-15",
    publishedISO: "2026-04-15T08:00:00-06:00",
    body: `
      <p>Facturar como psicólogo independiente parece intimidante al principio, pero con el régimen correcto y un sistema sencillo, se vuelve una tarea de cinco minutos por consulta. Esta guía resume lo esencial.</p>

      <h2>1. Elige el régimen fiscal correcto</h2>
      <p>Para la mayoría de psicólogos que trabajan por cuenta propia, el <strong>RESICO (Régimen Simplificado de Confianza)</strong> es la opción más amigable. Tasa fija del 1% al 2.5% sobre ingresos brutos, sin necesidad de deducir gastos. Si facturas más de 3.5 millones de pesos al año, debes pasar a Actividades Profesionales.</p>

      <h2>2. Da de alta tu actividad económica</h2>
      <p>Tu actividad ante el SAT debe ser <strong>"Servicios profesionales independientes - Psicología"</strong>. Si todavía no la tienes registrada, lo haces desde tu portal SAT o con una visita a la oficina más cercana.</p>

      <h2>3. Genera tus CFDI</h2>
      <p>Cada consulta cobrada requiere un CFDI (Comprobante Fiscal Digital por Internet). Datos clave:</p>
      <ul>
        <li><strong>Clave del producto/servicio:</strong> 86101705 (Servicios de psicología)</li>
        <li><strong>Clave de unidad:</strong> E48 (Unidad de servicio)</li>
        <li><strong>Uso del CFDI:</strong> "G03 - Gastos en general" si el paciente lo deduce; "P01 - Por definir" si no.</li>
        <li><strong>Régimen del receptor:</strong> El que tu paciente te indique (PF / PM).</li>
      </ul>
      <p>Hay decenas de plataformas para generar CFDI: el portal SAT (gratis pero austero), Facturama, Bind ERP, Contpaqi i-Factura. La mayoría cobra entre $40 y $200 MXN al mes.</p>

      <h2>4. Lleva la cuenta de tus ingresos</h2>
      <p>Aquí es donde tener un sistema ordenado evita problemas en abril. Cardigan lleva el registro de cada sesión cobrada y cada pago recibido por paciente. Al final del mes exportas un PDF con el desglose y se lo entregas a tu contador junto con tus CFDI emitidos. Esto es exactamente lo que hace un nutriólogo, un entrenador o un tutor con su propia variante de cobro.</p>

      <h2>5. Pagos provisionales mensuales</h2>
      <p>El RESICO presenta pago mensual a más tardar el día 17 del siguiente mes. Si te quedas atrás más de dos meses, el SAT te puede sacar del régimen y mandarte a Actividades Profesionales (mucho más complejo). Configura un recordatorio fijo en tu calendario.</p>

      <h2>Resumen práctico</h2>
      <ul>
        <li>Ingresos en RESICO: tasa fija sobre ingreso bruto (1%–2.5%), sin deducciones.</li>
        <li>Cada consulta cobrada = un CFDI generado.</li>
        <li>Lleva un registro digital ordenado (Cardigan, Excel, lo que sea — pero ordenado).</li>
        <li>Pago provisional cada mes antes del día 17.</li>
        <li>Si vendes a empresas, suben las complejidades — considera un contador.</li>
      </ul>

      <p>Esta guía es informativa, no asesoría fiscal. Para casos específicos, consulta a un contador.</p>
    `,
  },
  {
    slug: "expediente-clinico-digital-nom-024",
    title: "Expediente clínico digital: lo que dice la NOM-024 (versión simple)",
    description: "Resumen práctico de la NOM-024-SSA3-2012 para psicólogos y nutriólogos: qué exige sobre el expediente clínico digital, integridad, firma y conservación.",
    date: "2026-04-08",
    publishedISO: "2026-04-08T08:00:00-06:00",
    body: `
      <p>La NOM-024-SSA3-2012 es la norma oficial mexicana que regula los <strong>Sistemas de Información de Registro Electrónico para la Salud</strong>. Si llevas expediente clínico digital de tus pacientes, te aplica. Esta es la versión simple.</p>

      <h2>¿A quién aplica?</h2>
      <p>A toda persona física o moral que opera un sistema electrónico para registrar información de salud — eso incluye psicólogos clínicos, nutriólogos y cualquier profesional que documente atención sanitaria.</p>

      <h2>Lo que la norma exige (los 5 pilares)</h2>
      <ol>
        <li><strong>Integridad:</strong> los registros no pueden alterarse sin dejar rastro. Las modificaciones deben quedar auditadas (quién, cuándo, qué cambió).</li>
        <li><strong>Confidencialidad:</strong> control de acceso. Solo personal autorizado puede ver el expediente. Cardigan, por ejemplo, cifra las notas con tu propia contraseña.</li>
        <li><strong>Disponibilidad:</strong> el expediente debe estar accesible cuando se necesite — incluso años después.</li>
        <li><strong>Conservación:</strong> mínimo 5 años contados desde la última atención al paciente. La NOM-004 lo refrenda y exige el respaldo de los registros.</li>
        <li><strong>Interoperabilidad:</strong> los datos deben poder exportarse en formatos estándar para que un nuevo sistema pueda leerlos.</li>
      </ol>

      <h2>Lo que esto significa en la práctica</h2>
      <p>Si usas Word, Excel o Notion como expediente, técnicamente no cumples — esos sistemas no auditan cambios ni cifran por usuario. Necesitas una herramienta diseñada para el caso (Cardigan, OpenMRS, EVA si trabajas en hospital, etc.) o documentar manualmente cada cambio en una bitácora — que en la práctica nadie hace.</p>

      <h2>Qué pedir al elegir software</h2>
      <ul>
        <li>Cifrado en reposo y en tránsito (HTTPS + cifrado de notas).</li>
        <li>Auditoría de cambios (quién editó, cuándo, qué).</li>
        <li>Exportación de datos (JSON, PDF) sin candados.</li>
        <li>Política de privacidad clara que mencione la LFPDPPP.</li>
        <li>Respaldos regulares fuera del dispositivo principal.</li>
      </ul>

      <h2>¿Y si el SSA me audita?</h2>
      <p>En la práctica, las auditorías a consultorios independientes son raras. Pero si tienes un litigio (denuncia de un paciente, divorcio donde se piden tus notas, etc.), un juez sí puede pedir el expediente — y la integridad documental marca la diferencia entre un caso defendible y uno comprometido.</p>

      <p>Esta nota es informativa. Para casos específicos, consulta a un abogado en derecho sanitario.</p>
    `,
  },
  {
    slug: "5-consejos-control-pacientes-sin-perder-tiempo",
    title: "5 consejos para llevar el control de tus pacientes sin perder tiempo",
    description: "Trucos prácticos para llevar el control de pacientes (o clientes, alumnos) sin pasar dos horas a la semana administrando: agenda, cobros, notas y recordatorios.",
    date: "2026-03-28",
    publishedISO: "2026-03-28T08:00:00-06:00",
    body: `
      <p>Si estás leyendo esto, probablemente pasas más tiempo del que quisieras administrando tu consultorio (o estudio, o gimnasio). Estos son cinco hábitos sencillos que me han ahorrado horas.</p>

      <h2>1. Agenda recurrente, no agenda manual</h2>
      <p>Si un paciente viene cada lunes a las 4 pm, no agendes la sesión cada semana — configura una recurrencia. Cardigan, Google Calendar y casi cualquier herramienta moderna lo permite. Una hora de configuración inicial te ahorra cinco minutos al día durante un año.</p>

      <h2>2. Cobra al inicio, no al final</h2>
      <p>Cobrar después de la sesión genera incomodidad ("¿cómo le digo que no me pagó la pasada?"). Cobrar al inicio elimina esa fricción y baja la tasa de impago casi a cero. Si manejas paquetes, anuncia el cobro del próximo paquete una semana antes de que se acabe el actual.</p>

      <h2>3. Notas inmediatas, no diferidas</h2>
      <p>Escribe las notas dentro de los primeros cinco minutos después de cada sesión. La memoria a corto plazo se evapora rápido — postergarlo a "esta noche" significa perder el 70% del detalle clínico relevante. Cuatro bullets de cinco palabras son mejor que un párrafo perfecto que nunca escribes.</p>

      <h2>4. Recordatorios automáticos</h2>
      <p>El número uno predictor de inasistencias es no recordarle al paciente. Una notificación push (no solo correo, que se pierde) 30 minutos antes baja las inasistencias en ~40%. Si tu sistema no lo hace solo, configura un recordatorio en Calendar.</p>

      <h2>5. Una sola fuente de verdad</h2>
      <p>El error más común: agenda en Google Calendar, pagos en una hoja de Excel, notas en una libreta, contactos en WhatsApp. Cuando un paciente te pregunta "¿cuánto te debo?", abres tres apps. Mover todo a un solo lugar (Cardigan, Notion, lo que sea) es la inversión de fin de semana que más rinde de cualquier otra.</p>

      <h2>El meta-consejo</h2>
      <p>El sistema perfecto que requiere disciplina diaria pierde contra el sistema imperfecto que se mantiene solo. Elige la herramienta que minimiza el trabajo administrativo, no la que tiene más funciones.</p>
    `,
  },
];

/* ── Icon glyphs (inline SVG) ─────────────────────────────────────── */
function icon(name) {
  const path = {
    lock:    `<path d="M5 11h14v10H5V11zM7 11V7a5 5 0 0110 0v4"/>`,
    calendar:`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>`,
    wallet:  `<path d="M3 7h18v12H3z"/><path d="M3 7v10a2 2 0 002 2h16V9H5a2 2 0 01-2-2zM17 13h.01"/>`,
    doc:     `<path d="M14 3v5h5M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/>`,
    bell:    `<path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9z"/><path d="M10 21a2 2 0 004 0"/>`,
    shield:  `<path d="M12 3l8 4v6c0 5-4 8-8 8s-8-3-8-8V7l8-4z"/>`,
    scale:   `<path d="M4 21h16M9 21V8M15 21V8M9 4l-3 4h6L9 4zM15 4l3 4h-6l3-4z"/><circle cx="6" cy="9" r="3"/><circle cx="18" cy="9" r="3"/>`,
    inbody:  `<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/><circle cx="17" cy="17" r="2"/>`,
  };
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden>${path[name] || ""}</svg>`;
}

const TRUST = [
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> 30 días gratis, sin tarjeta`,
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Cumple LFPDPPP`,
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Cancela cuando quieras`,
];

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ── Page templates ──────────────────────────────────────────────── */

function professionPage(p) {
  return `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(p.title)} — Cardigan</title>
<meta name="description" content="${escapeHtml(p.description)}" />
<meta name="keywords" content="${escapeHtml(p.keyword)}, agenda ${p.label}, control ${p.client}, app ${p.label}" />
<link rel="canonical" href="https://cardigan.mx/${p.slug}/" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta name="theme-color" content="#FFFFFF" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="es_MX" />
<meta property="og:site_name" content="Cardigan" />
<meta property="og:title" content="${escapeHtml(p.title)} — Cardigan" />
<meta property="og:description" content="${escapeHtml(p.description)}" />
<meta property="og:url" content="https://cardigan.mx/${p.slug}/" />
<meta property="og:image" content="https://cardigan.mx/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(p.title)} — Cardigan" />
<meta name="twitter:description" content="${escapeHtml(p.description)}" />
<meta name="twitter:image" content="https://cardigan.mx/og-image.png" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Cardigan",
  "operatingSystem": "Web, iOS, Android",
  "applicationCategory": "BusinessApplication",
  "url": "https://cardigan.mx/${p.slug}/",
  "description": "${escapeHtml(p.description)}",
  "inLanguage": "es-MX",
  "offers": {
    "@type": "Offer",
    "price": "299",
    "priceCurrency": "MXN",
    "category": "Subscription",
    "availability": "https://schema.org/InStock"
  }
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    ${p.faqs.map(f => `{
      "@type": "Question",
      "name": ${JSON.stringify(f.q)},
      "acceptedAnswer": { "@type": "Answer", "text": ${JSON.stringify(f.a)} }
    }`).join(",\n    ")}
  ]
}
</script>
<link rel="stylesheet" href="/marketing.css" />
</head>
<body>
<div class="mkt-page">
  <header class="mkt-nav">
    <div class="mkt-nav-inner">
      <a href="/" class="mkt-brand"><img src="/icon-mono.svg" alt="" /> cardigan</a>
      <nav class="mkt-nav-actions">
        <a href="/blog/" class="mkt-nav-link">Blog</a>
        <a href="/" class="mkt-nav-link">Iniciar sesión</a>
        <a href="/" class="mkt-nav-cta">Comenzar gratis</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="mkt-hero">
      <div class="mkt-container">
        <span class="mkt-hero-eyebrow">Cardigan para ${p.label}</span>
        <h1>${escapeHtml(p.heroH1)}</h1>
        <p class="lead">${escapeHtml(p.heroLead)}</p>
        <div class="mkt-hero-cta-row">
          <a href="/" class="mkt-btn-primary">Comenzar gratis</a>
          <a href="#precios" class="mkt-btn-secondary">Ver precios</a>
        </div>
        <div class="mkt-trust">
          ${TRUST.map(t => `<span class="mkt-trust-item">${t}</span>`).join("\n          ")}
        </div>
      </div>
    </section>

    <section class="mkt-features">
      <div class="mkt-container">
        <h2 class="mkt-features-h">Lo necesario, nada más.</h2>
        <p class="mkt-features-sub">Diseñado para ${p.label}. Sin las complicaciones de un sistema hospitalario.</p>
        <div class="mkt-features-grid">
          ${p.features.map(f => `
          <div class="mkt-feature">
            <div class="mkt-feature-icon">${icon(f.icon)}</div>
            <h3>${escapeHtml(f.h)}</h3>
            <p>${escapeHtml(f.body)}</p>
          </div>`).join("")}
        </div>
      </div>
    </section>

    <section class="mkt-pricing" id="precios">
      <div class="mkt-container">
        <h2 class="mkt-features-h">Un solo precio. Sin sorpresas.</h2>
        <p class="mkt-features-sub">30 días gratis. Después decides.</p>
        <div class="mkt-pricing-card">
          <div class="mkt-pricing-name">Cardigan Pro</div>
          <div class="mkt-pricing-amount"><strong>$299</strong><span>MXN / mes</span></div>
          <div class="mkt-pricing-note">o $2,990 MXN al año (ahorra 17%)</div>
          <ul class="mkt-pricing-list">
            <li>Acceso completo a todas las funciones</li>
            <li>${escapeHtml(p.client[0].toUpperCase() + p.client.slice(1))} ilimitados</li>
            <li>${escapeHtml(p.session[0].toUpperCase() + p.session.slice(1))} ilimitadas</li>
            <li>Notas y documentos por ${escapeHtml(p.clientS)}</li>
            <li>Recordatorios automáticos</li>
            <li>Sincronización con tu calendario</li>
            <li>Cancela cuando quieras</li>
          </ul>
          <a href="/" class="mkt-btn-primary" style="display:block">Comenzar gratis</a>
        </div>
      </div>
    </section>

    <section>
      <div class="mkt-container">
        <h2 class="mkt-features-h">Preguntas frecuentes</h2>
        <p class="mkt-features-sub">¿Algo más? <a href="mailto:hola@cardigan.mx">hola@cardigan.mx</a></p>
        <div class="mkt-faq-list">
          ${p.faqs.map(f => `
          <details class="mkt-faq">
            <summary>${escapeHtml(f.q)}</summary>
            <div class="mkt-faq-body">${escapeHtml(f.a)}</div>
          </details>`).join("")}
        </div>
      </div>
    </section>

    <section class="mkt-cta">
      <div class="mkt-container">
        <h2>Empieza hoy. Sin tarjeta.</h2>
        <p>30 días gratis. Después $299 MXN al mes o $2,990 al año.</p>
        <a href="/" class="mkt-btn-primary">Comenzar gratis</a>
      </div>
    </section>
  </main>

  <footer class="mkt-footer">
    <div class="mkt-footer-cols">
      <div class="mkt-footer-brand">
        <div class="mkt-footer-brand-row"><img src="/icon-mono.svg" alt="" width="20" height="20" /> cardigan</div>
        <div class="mkt-footer-tag">Hecho en México · 2026</div>
      </div>
      <div class="mkt-footer-cluster">
        <div class="mkt-footer-cluster-h">Producto</div>
        <ul>
          <li><a href="/">Inicio</a></li>
          <li><a href="/psicologos/">Para psicólogos</a></li>
          <li><a href="/nutriologos/">Para nutriólogos</a></li>
          <li><a href="/entrenadores/">Para entrenadores</a></li>
          <li><a href="/maestros-de-musica/">Para maestros de música</a></li>
          <li><a href="/tutores/">Para tutores</a></li>
          <li><a href="/blog/">Blog</a></li>
        </ul>
      </div>
      <div class="mkt-footer-cluster">
        <div class="mkt-footer-cluster-h">Soporte</div>
        <ul>
          <li><a href="mailto:hola@cardigan.mx">hola@cardigan.mx</a></li>
          <li><a href="mailto:privacy@cardigan.mx">Privacidad</a></li>
        </ul>
      </div>
    </div>
    <div class="mkt-footer-bottom">© 2026 Cardigan. Hecho en México con cuidado.</div>
  </footer>
</div>
</body>
</html>
`;
}

function blogIndexPage() {
  const cards = ARTICLES.map(a => `
    <a href="/blog/${a.slug}/" class="mkt-blog-card">
      <div class="mkt-blog-card-meta">${a.date}</div>
      <h3>${escapeHtml(a.title)}</h3>
      <p>${escapeHtml(a.description)}</p>
    </a>`).join("");

  return `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="UTF-8" />
<title>Blog — Cardigan</title>
<meta name="description" content="Artículos prácticos para psicólogos, nutriólogos, entrenadores y profesores particulares en México: facturación, expediente clínico, control de pacientes y más." />
<link rel="canonical" href="https://cardigan.mx/blog/" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta name="theme-color" content="#FFFFFF" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="es_MX" />
<meta property="og:site_name" content="Cardigan" />
<meta property="og:title" content="Blog — Cardigan" />
<meta property="og:url" content="https://cardigan.mx/blog/" />
<meta property="og:image" content="https://cardigan.mx/og-image.png" />
<link rel="stylesheet" href="/marketing.css" />
</head>
<body>
<div class="mkt-page">
  <header class="mkt-nav">
    <div class="mkt-nav-inner">
      <a href="/" class="mkt-brand"><img src="/icon-mono.svg" alt="" /> cardigan</a>
      <nav class="mkt-nav-actions">
        <a href="/" class="mkt-nav-link">Iniciar sesión</a>
        <a href="/" class="mkt-nav-cta">Comenzar gratis</a>
      </nav>
    </div>
  </header>

  <main>
    <section>
      <div class="mkt-container">
        <h1 class="mkt-features-h" style="text-align:left">Blog</h1>
        <p class="mkt-features-sub" style="text-align:left;margin-left:0">Notas prácticas para profesionales independientes en México.</p>
        <div class="mkt-blog-grid">${cards}</div>
      </div>
    </section>
  </main>

  <footer class="mkt-footer">
    <div class="mkt-footer-bottom">© 2026 Cardigan. Hecho en México.</div>
  </footer>
</div>
</body>
</html>
`;
}

function articlePage(a) {
  return `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(a.title)} — Blog Cardigan</title>
<meta name="description" content="${escapeHtml(a.description)}" />
<link rel="canonical" href="https://cardigan.mx/blog/${a.slug}/" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta name="theme-color" content="#FFFFFF" />
<meta property="og:type" content="article" />
<meta property="og:locale" content="es_MX" />
<meta property="og:site_name" content="Cardigan" />
<meta property="og:title" content="${escapeHtml(a.title)}" />
<meta property="og:description" content="${escapeHtml(a.description)}" />
<meta property="og:url" content="https://cardigan.mx/blog/${a.slug}/" />
<meta property="og:image" content="https://cardigan.mx/og-image.png" />
<meta property="article:published_time" content="${a.publishedISO}" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": ${JSON.stringify(a.title)},
  "description": ${JSON.stringify(a.description)},
  "datePublished": "${a.publishedISO}",
  "author": { "@type": "Organization", "name": "Cardigan" },
  "publisher": {
    "@type": "Organization",
    "name": "Cardigan",
    "logo": { "@type": "ImageObject", "url": "https://cardigan.mx/icon-192.png" }
  },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "https://cardigan.mx/blog/${a.slug}/" },
  "inLanguage": "es-MX"
}
</script>
<link rel="stylesheet" href="/marketing.css" />
</head>
<body>
<div class="mkt-page">
  <header class="mkt-nav">
    <div class="mkt-nav-inner">
      <a href="/" class="mkt-brand"><img src="/icon-mono.svg" alt="" /> cardigan</a>
      <nav class="mkt-nav-actions">
        <a href="/blog/" class="mkt-nav-link">Blog</a>
        <a href="/" class="mkt-nav-link">Iniciar sesión</a>
        <a href="/" class="mkt-nav-cta">Comenzar gratis</a>
      </nav>
    </div>
  </header>

  <main>
    <article class="mkt-article">
      <a href="/blog/" class="mkt-article-back">← Volver al blog</a>
      <div class="mkt-article-meta">${a.date} · Cardigan</div>
      <h1>${escapeHtml(a.title)}</h1>
      ${a.body}
    </article>

    <section class="mkt-cta">
      <div class="mkt-container">
        <h2>¿Te suena Cardigan?</h2>
        <p>30 días gratis. Sin tarjeta.</p>
        <a href="/" class="mkt-btn-primary">Comenzar gratis</a>
      </div>
    </section>
  </main>

  <footer class="mkt-footer">
    <div class="mkt-footer-bottom">© 2026 Cardigan. Hecho en México.</div>
  </footer>
</div>
</body>
</html>
`;
}

/* ── Sitemap.xml regen ───────────────────────────────────────────── */
function sitemapXml() {
  const urls = [
    { loc: "https://cardigan.mx/",                changefreq: "weekly",  priority: "1.0" },
    { loc: "https://cardigan.mx/blog/",           changefreq: "weekly",  priority: "0.8" },
    ...PROFESSIONS.map(p => ({
      loc: `https://cardigan.mx/${p.slug}/`,
      changefreq: "monthly",
      priority: "0.9",
    })),
    ...ARTICLES.map(a => ({
      loc: `https://cardigan.mx/blog/${a.slug}/`,
      changefreq: "monthly",
      priority: "0.7",
      lastmod: a.date,
    })),
  ];
  const items = urls.map(u =>
    `  <url>\n    <loc>${u.loc}</loc>\n` +
    (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : "") +
    `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

/* ── Write all files ─────────────────────────────────────────────── */
async function write(rel, contents) {
  const fullPath = resolve(PUBLIC, rel);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents);
  console.log("  ✓ wrote", rel);
}

async function main() {
  console.log("Building static marketing pages…");
  for (const p of PROFESSIONS) {
    await write(`${p.slug}/index.html`, professionPage(p));
  }
  await write("blog/index.html", blogIndexPage());
  for (const a of ARTICLES) {
    await write(`blog/${a.slug}/index.html`, articlePage(a));
  }
  await write("sitemap.xml", sitemapXml());
  console.log("Done.");
}

main().catch(err => { console.error(err); process.exit(1); });
