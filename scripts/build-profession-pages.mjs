#!/usr/bin/env node
/* ── build-profession-pages.mjs ──────────────────────────────────────
   Generates the per-profession marketing pages
   (public/<slug>/index.html) from a single template and per-profession
   configs. The template renders the same chrome the SPA landing
   does — sticky nav, hero with phone preview + floating "próxima"
   card, trust pills, feature deck, three-mini-mock strip, "cómo
   empezar" steps, pricing card, FAQ, closing CTA, footer — but in
   plain HTML so search-engine crawlers see real content from request
   1 with no JS required.

   Run with `node scripts/build-profession-pages.mjs`. The script
   wipes + rewrites public/<slug>/index.html for each config so it's
   idempotent — re-run after editing copy, the diff is the new
   content.

   Adding a profession:
     1. Add an entry to PROFESSIONS below.
     2. Run the script.
     3. Add the slug to public/sitemap.xml.
     4. Surface a link in src/components/landing/LandingPage.jsx and
        in this template's footer.

   No template engine — straight tagged-template literals + helper
   functions. Keeps the script dependency-free (`node` only). */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

/* ── Profession configs ──────────────────────────────────────────
   Each config drives one /<slug>/index.html. Fields that vary the
   most are per-profession copy + the mock data inside the phone /
   minis; everything else (nav, footer, pricing card, trust pills) is
   shared across pages. */

const CANONICAL = "https://cardigan.mx";

const SHARED_FAQ_TAIL = [
  {
    q: "¿Funciona en mi celular?",
    a: "Sí. Cardigan funciona en iPhone, iPad y Android — se instala como una app desde tu navegador en 10 segundos. También tiene una versión completa para escritorio.",
  },
  {
    q: "¿Hay contrato?",
    a: "No. Es una suscripción mensual ($299 MXN) que puedes cancelar desde la app cuando quieras. Sin penalizaciones.",
  },
  {
    q: "¿Qué pasa si decido cancelar?",
    a: "Tus datos se quedan intactos. Si vuelves al mes siguiente, todo sigue donde lo dejaste — pacientes, notas, sesiones, pagos.",
  },
];

const SHARED_PRICING_LIST = [
  "Acceso completo a todas las funciones",
  "Pacientes ilimitados",
  "Sesiones ilimitadas",
  "Notas y documentos por paciente",
  "Recordatorios automáticos",
  "Sincronización con tu calendario",
  "Cancela cuando quieras",
];

const PROFESSIONS = [
  {
    slug: "psicologos",
    label: "psicólogos",
    title: "Software para psicólogos en México — Cardigan",
    seoDescription:
      "La app para psicólogos en México: agenda, expediente, pagos y notas cifradas — todo en un solo lugar. 30 días gratis, sin tarjeta.",
    keywords:
      "software psicólogos méxico, agenda psicólogos, control pacientes, app psicólogos",
    breadcrumb: "Para psicólogos",
    hero: {
      eyebrow: "Cardigan para psicólogos",
      h1: "Tu consultorio, en un solo lugar.",
      lead: "Cardigan reúne agenda, expediente, pagos y notas clínicas cifradas para psicólogos en México. Pensado para que dediques menos tiempo a la administración y más a tus pacientes.",
    },
    featuresIntro:
      "Diseñado para psicólogos. Sin las complicaciones de un sistema hospitalario.",
    features: [
      { icon: "lock", h: "Notas cifradas de extremo a extremo", p: "Tus apuntes clínicos viajan cifrados con tu propia contraseña — ni siquiera nosotros podemos leerlos." },
      { icon: "calendar", h: "Agenda recurrente", p: "Sesiones semanales, quincenales o personalizadas. Cardigan extiende tu agenda solita y te avisa antes de cada cita." },
      { icon: "dollar", h: "Honorarios sin esfuerzo", p: "Cardigan calcula automáticamente lo que cada paciente debe en base a las sesiones tomadas y los pagos recibidos." },
      { icon: "file", h: "Expediente por paciente", p: "Documentos, notas, evaluaciones y antecedentes — todo organizado en una sola ficha." },
      { icon: "bell", h: "Recordatorios automáticos", p: "Notificaciones push antes de cada sesión. Tú no faltas y tus pacientes tampoco." },
      { icon: "shield", h: "Cumple LFPDPPP", p: "Cifrado en reposo + en tránsito, política de privacidad clara, exportación de datos a un toque." },
    ],
    phone: {
      kpis: [
        { label: "Sesiones hoy", value: "3", meta: "Hoy", red: false },
        { label: "Pacientes",    value: "27", meta: "21 activos", red: false },
        { label: "Cobrado (Mes)", value: "$24,800", meta: "Mes en curso", red: false },
        { label: "No cobrado",   value: "$3,200", meta: "2 con saldo", red: true },
      ],
      sessions: [
        { initials: "AM", patient: "Andrea M.",  time: "10:00 - 11:00", modality: "presencial", status: "scheduled" },
        { initials: "DR", patient: "Daniel R.",  time: "12:00 - 13:00", modality: "virtual",    status: "scheduled" },
        { initials: "SP", patient: "Sofía P.",   time: "16:00 - 17:00", modality: "presencial", status: "scheduled" },
      ],
      float: { initials: "EM", patient: "Emiliano M.", sub: "Mañana 10:00 · Próxima", badge: "Al día" },
    },
    minis: [
      {
        label: "Tu día. De un vistazo.",
        kind: "sessions",
        rows: [
          { initials: "AM", patient: "Andrea M.",  time: "10:00 - 11:00", modality: "presencial", status: "scheduled" },
          { initials: "DR", patient: "Daniel R.",  time: "12:00 - 13:00", modality: "virtual",    status: "scheduled" },
        ],
      },
      {
        label: "Cada paciente, un toque.",
        kind: "patients",
        rows: [
          { initials: "AM", patient: "Andrea Méndez", sub: "$1,200 por sesión", badge: "Activo" },
          { initials: "LM", patient: "Lucía Morales", sub: "$1,000 por sesión", badge: "Activo", tutor: false },
        ],
      },
      {
        label: "Tu mes, en limpio.",
        kind: "finances",
        kpis: [
          { label: "Cobrado (Mes)", value: "$24,800", meta: "Mes en curso", red: false },
          { label: "No cobrado",    value: "$3,200",  meta: "2 con saldo",  red: true },
        ],
      },
    ],
    steps: [
      { num: 1, label: "Crea tu cuenta" },
      { num: 2, label: "Agrega tu primer paciente" },
      { num: 3, label: "Agenda tu primera sesión" },
    ],
    faq: [
      {
        q: "¿Mis notas están seguras?",
        a: "Sí. Las notas se cifran de extremo a extremo con una contraseña que solo tú conoces. Ni Cardigan ni nadie en nuestro equipo puede leerlas. Cumplimos con la LFPDPPP.",
      },
      {
        q: "¿Puedo exportar a mis pacientes?",
        a: "Sí. Desde Ajustes → Privacidad puedes descargar todos tus datos en formato JSON. Sin candados — son tus datos.",
      },
      ...SHARED_FAQ_TAIL,
    ],
  },

  {
    slug: "nutriologos",
    label: "nutriólogos",
    title: "Software para nutriólogos en México — Cardigan",
    seoDescription:
      "La app para nutriólogos en México: agenda de consultas, importación de InBody, mediciones corporales, planes alimenticios y pagos — en un solo lugar. 30 días gratis.",
    keywords:
      "software nutriólogos méxico, agenda nutriólogos, control pacientes, app nutriólogos, inbody",
    breadcrumb: "Para nutriólogos",
    hero: {
      eyebrow: "Cardigan para nutriólogos",
      h1: "Tus pacientes, sus mediciones, tus pagos.",
      lead: "Cardigan reúne agenda de consultas, importación de InBody, gráficos de progreso corporal y cobros para nutriólogos en México. Menos hojas sueltas, más tiempo con tus pacientes.",
    },
    featuresIntro:
      "Diseñado para nutriólogos. Sin las complicaciones de un sistema hospitalario.",
    features: [
      { icon: "inbody", h: "Importa tus InBody", p: "Sube el CSV o Excel de LookinBody y todas las mediciones — músculo esquelético, grasa visceral, ángulo de fase — aparecen en el historial del paciente con gráficas listas." },
      { icon: "chart", h: "Mediciones con gráficos", p: "Peso, % grasa, perímetros — guarda mediciones y visualiza el progreso de cada paciente con gráficos automáticos." },
      { icon: "calendar", h: "Agenda de consultas", p: "Consultas recurrentes, recordatorios automáticos y vista de mes / semana / día. Cancela una cita y Cardigan reorganiza el resto." },
      { icon: "file", h: "Plan alimenticio en notas", p: "Adjunta planes, antecedentes médicos, alergias y foto del último análisis a la ficha de cada paciente." },
      { icon: "dollar", h: "Cobros y saldos al instante", p: "Lleva el control de pagos por consulta o por paquete. Cardigan calcula automáticamente lo que cada paciente debe." },
      { icon: "shield", h: "Cumple LFPDPPP", p: "Datos cifrados en reposo y en tránsito. Exportación de información de cada paciente con un toque." },
    ],
    phone: {
      kpis: [
        { label: "Consultas hoy", value: "4", meta: "Hoy", red: false },
        { label: "Pacientes",     value: "32", meta: "25 activos", red: false },
        { label: "Cobrado (Mes)", value: "$28,400", meta: "Mes en curso", red: false },
        { label: "No cobrado",    value: "$2,800",  meta: "2 con saldo", red: true },
      ],
      sessions: [
        { initials: "MG", patient: "Mariana G.",  time: "09:00 - 09:45", modality: "presencial", status: "scheduled" },
        { initials: "JR", patient: "Javier R.",   time: "11:30 - 12:15", modality: "virtual",    status: "scheduled" },
        { initials: "PC", patient: "Paola C.",    time: "16:00 - 16:45", modality: "presencial", status: "scheduled" },
      ],
      float: { initials: "MG", patient: "Mariana G.", sub: "Mañana 10:00 · Próxima", badge: "Al día" },
    },
    minis: [
      {
        label: "Tus consultas del día.",
        kind: "sessions",
        rows: [
          { initials: "MG", patient: "Mariana G.", time: "09:00 - 09:45", modality: "presencial", status: "scheduled" },
          { initials: "JR", patient: "Javier R.",  time: "11:30 - 12:15", modality: "virtual",    status: "scheduled" },
        ],
      },
      {
        label: "El progreso, claro.",
        kind: "chart",
        title: "Peso · Mariana G.",
        delta: "−4.2 kg",
        bars: [38, 56, 70, 84, 92],
        axis: ["Ene", "Feb", "Mar", "Abr", "May"],
      },
      {
        label: "Tu mes, en limpio.",
        kind: "finances",
        kpis: [
          { label: "Cobrado (Mes)", value: "$28,400", meta: "Mes en curso", red: false },
          { label: "No cobrado",    value: "$2,800",  meta: "2 con saldo",  red: true },
        ],
      },
    ],
    steps: [
      { num: 1, label: "Crea tu cuenta" },
      { num: 2, label: "Importa tu primer InBody" },
      { num: 3, label: "Agenda tu primera consulta" },
    ],
    faq: [
      {
        q: "¿Puedo importar mis InBody?",
        a: "Sí. Exporta el archivo desde LookinBody en formato CSV o Excel (.xlsx), de cualquier modelo (270, 570, 770, 970), súbelo a Cardigan, revisa la lista y confirma. Las mediciones de músculo esquelético, grasa visceral, ángulo de fase y InBody Score aparecen en el historial del paciente con gráficas listas. Re-importar el mismo archivo es seguro: las mediciones repetidas se omiten automáticamente.",
      },
      {
        q: "¿Puedo subir planes alimenticios y análisis?",
        a: "Sí. Sube PDFs, imágenes o Word a la ficha de cada paciente — quedan vinculados a su historial y se pueden consultar en cualquier momento.",
      },
      {
        q: "¿Cardigan grafica el peso de mis pacientes?",
        a: "Sí. Captura las mediciones (peso, % grasa, músculo, perímetros) en cada consulta y verás el progreso en una gráfica automática, con deltas desde la primera medición. Si el paciente tiene escaneos InBody, la gráfica cambia entre métricas con un toque.",
      },
      ...SHARED_FAQ_TAIL,
    ],
  },

  {
    slug: "entrenadores",
    label: "entrenadores",
    title: "App para entrenadores personales en México — Cardigan",
    seoDescription:
      "La app para entrenadores personales en México: agenda, mediciones corporales, planes y pagos de tus clientes — en un solo lugar. 30 días gratis.",
    keywords:
      "app entrenador personal méxico, agenda entrenadores, control clientes, app entrenadores",
    breadcrumb: "Para entrenadores",
    hero: {
      eyebrow: "Cardigan para entrenadores personales",
      h1: "Tus clientes, sus avances, tus cobros.",
      lead: "Cardigan reúne agenda, mediciones corporales con gráficos de progreso, paquetes y cobros para entrenadores personales en México. Menos administración, más tiempo entrenando.",
    },
    featuresIntro:
      "Diseñado para entrenadores. Funciona a domicilio, en gimnasio o en línea.",
    features: [
      { icon: "chart", h: "Mediciones con gráficos", p: "Peso, % grasa, perímetros, fuerza — guarda los números y mira el progreso de cada cliente en gráficas automáticas." },
      { icon: "calendar", h: "Agenda flexible", p: "Sesiones a domicilio, en gimnasio, en parque o en línea. Cancela una cita y Cardigan reorganiza el resto solita." },
      { icon: "package", h: "Paquetes y suscripciones", p: "Cobra por sesión, por paquete (10 sesiones) o como mensualidad. Cardigan rastrea lo consumido vs. lo pagado." },
      { icon: "dollar", h: "Cobros sin enredos", p: "El saldo de cada cliente se actualiza solo. Recibe pagos en línea con tarjeta directo desde la app." },
      { icon: "bell", h: "Recordatorios automáticos", p: "Push antes de cada entrenamiento. Tu cliente se prepara, tú no llegas con sorpresas." },
      { icon: "smartphone", h: "Funciona donde tú entrenas", p: "Cardigan vive en tu celular. Sin internet en el parque, guarda tu trabajo y sincroniza al volver." },
    ],
    phone: {
      kpis: [
        { label: "Sesiones hoy", value: "5", meta: "Hoy", red: false },
        { label: "Clientes",     value: "18", meta: "16 activos", red: false },
        { label: "Cobrado (Mes)", value: "$32,500", meta: "Mes en curso", red: false },
        { label: "No cobrado",    value: "$1,800",  meta: "1 con saldo",  red: true },
      ],
      sessions: [
        { initials: "RG", patient: "Rodrigo G.", time: "06:00 - 07:00", modality: "presencial", status: "scheduled" },
        { initials: "VC", patient: "Valeria C.", time: "08:00 - 09:00", modality: "adomicilio", status: "scheduled" },
        { initials: "CN", patient: "Carlos N.",  time: "18:00 - 19:00", modality: "presencial", status: "scheduled" },
      ],
      float: { initials: "RG", patient: "Rodrigo G.", sub: "Hoy 06:00 · Próxima", badge: "Al día" },
    },
    minis: [
      {
        label: "Tu día. Sin sorpresas.",
        kind: "sessions",
        rows: [
          { initials: "RG", patient: "Rodrigo G.", time: "06:00 - 07:00", modality: "presencial", status: "scheduled" },
          { initials: "VC", patient: "Valeria C.", time: "08:00 - 09:00", modality: "adomicilio", status: "scheduled" },
        ],
      },
      {
        label: "El progreso, en gráfica.",
        kind: "chart",
        title: "Peso · Rodrigo G.",
        delta: "+3.1 kg músc.",
        bars: [42, 50, 64, 78, 86],
        axis: ["Ene", "Feb", "Mar", "Abr", "May"],
      },
      {
        label: "Cobras lo que toca.",
        kind: "finances",
        kpis: [
          { label: "Cobrado (Mes)", value: "$32,500", meta: "Mes en curso", red: false },
          { label: "No cobrado",    value: "$1,800",  meta: "1 con saldo",  red: true },
        ],
      },
    ],
    steps: [
      { num: 1, label: "Crea tu cuenta" },
      { num: 2, label: "Agrega tu primer cliente" },
      { num: 3, label: "Agenda tu primera sesión" },
    ],
    faq: [
      {
        q: "¿Puedo registrar mediciones de cada cliente?",
        a: "Sí. Captura peso, % grasa, perímetros y fuerza en cada sesión. Cardigan grafica el progreso automáticamente y te dice cuánto ha cambiado desde la primera medición.",
      },
      {
        q: "¿Manejo paquetes de varias sesiones?",
        a: "Sí. Puedes cobrar por sesión individual, por paquete (10 sesiones, 1 mes, etc.) o como suscripción mensual. Cardigan rastrea las sesiones consumidas vs. pagadas.",
      },
      {
        q: "¿Funciona en el gimnasio sin internet?",
        a: "Sí. Cardigan guarda tu trabajo localmente y sincroniza cuando vuelves a tener señal.",
      },
      {
        q: "¿Es solo para entrenadores con consultorio?",
        a: "No. Cardigan funciona para entrenadores que trabajan a domicilio, en parques, en gimnasios o en línea — la modalidad de cada sesión se configura por separado.",
      },
      ...SHARED_FAQ_TAIL,
    ],
  },

  {
    slug: "maestros-de-musica",
    label: "maestros de música",
    title: "App para maestros de música en México — Cardigan",
    seoDescription:
      "La app para maestros de música en México: agenda de clases, control de alumnos, mensualidades y notas — en un solo lugar. 30 días gratis.",
    keywords:
      "app maestros música méxico, agenda clases música, control alumnos música, app maestros piano guitarra",
    breadcrumb: "Para maestros de música",
    hero: {
      eyebrow: "Cardigan para maestros de música",
      h1: "Tus alumnos, sus clases, tu cobro.",
      lead: "Cardigan reúne agenda de clases, control de alumnos, mensualidades y notas de avance para maestros de música en México. Menos hojas sueltas, más tiempo enseñando.",
    },
    featuresIntro:
      "Diseñado para maestros de música. Piano, guitarra, canto, violín — la disciplina no importa.",
    features: [
      { icon: "calendar", h: "Agenda de clases", p: "Clases recurrentes, semanales o personalizadas. Cardigan extiende tu agenda y avisa antes de cada lección." },
      { icon: "users", h: "Cada alumno, una ficha", p: "Repertorio, avances, ejercicios, datos del padre o tutor — todo organizado por alumno." },
      { icon: "dollar", h: "Mensualidades sin estrés", p: "Cobra por clase o por mes. Cardigan calcula lo que cada alumno debe y te dice quién está al corriente." },
      { icon: "file", h: "Notas y partituras", p: "Sube partituras, audios, videos de referencia y notas de cada clase. Disponibles en la ficha del alumno cuando las necesites." },
      { icon: "bell", h: "Recordatorios automáticos", p: "Notificación push antes de cada clase. Tu alumno llega preparado, tú no llegas con sorpresas." },
      { icon: "smartphone", h: "App sin App Store", p: "Cardigan vive en tu celular y en tu computadora. La instalas desde el navegador, sin descargas." },
    ],
    phone: {
      kpis: [
        { label: "Clases hoy",   value: "4", meta: "Hoy", red: false },
        { label: "Alumnos",      value: "22", meta: "20 activos", red: false },
        { label: "Cobrado (Mes)", value: "$18,600", meta: "Mes en curso", red: false },
        { label: "No cobrado",   value: "$2,400",  meta: "3 con saldo",  red: true },
      ],
      sessions: [
        { initials: "DM", patient: "Diego M.",     time: "15:00 - 16:00", modality: "presencial", status: "scheduled" },
        { initials: "RC", patient: "Renata C.",    time: "16:30 - 17:30", modality: "presencial", status: "scheduled" },
        { initials: "SE", patient: "Santiago E.",  time: "18:00 - 19:00", modality: "virtual",    status: "scheduled" },
      ],
      float: { initials: "DM", patient: "Diego M.", sub: "Hoy 15:00 · Próxima", badge: "Al día" },
    },
    minis: [
      {
        label: "Tu día de clases.",
        kind: "sessions",
        rows: [
          { initials: "DM", patient: "Diego M.",  time: "15:00 - 16:00", modality: "presencial", status: "scheduled" },
          { initials: "RC", patient: "Renata C.", time: "16:30 - 17:30", modality: "presencial", status: "scheduled" },
        ],
      },
      {
        label: "Cada alumno, un toque.",
        kind: "patients",
        rows: [
          { initials: "DM", patient: "Diego Mendoza",  sub: "$650 por clase", badge: "Activo", tutor: false },
          { initials: "RC", patient: "Renata Castillo", sub: "Tutor: Marisol C. · $600", badge: "Activo", tutor: true },
        ],
      },
      {
        label: "Tu mes, sin cuentas mentales.",
        kind: "finances",
        kpis: [
          { label: "Cobrado (Mes)", value: "$18,600", meta: "Mes en curso", red: false },
          { label: "No cobrado",    value: "$2,400",  meta: "3 con saldo",  red: true },
        ],
      },
    ],
    steps: [
      { num: 1, label: "Crea tu cuenta" },
      { num: 2, label: "Agrega tu primer alumno" },
      { num: 3, label: "Agenda tu primera clase" },
    ],
    faq: [
      {
        q: "¿Puedo manejar alumnos menores de edad?",
        a: "Sí. Cardigan permite registrar al padre o tutor de cada alumno menor — sus datos viven en la misma ficha y los recordatorios pueden ir a su número.",
      },
      {
        q: "¿Sirve para clases en línea?",
        a: "Sí. Marca una clase como virtual y Cardigan la diferencia visualmente en la agenda. Funciona igual de bien para clases presenciales, en línea o a domicilio.",
      },
      {
        q: "¿Puedo subir partituras y audios?",
        a: "Sí. Sube PDFs, imágenes, audios o videos a la ficha de cada alumno. Quedan organizados por clase y los puedes consultar en cualquier momento.",
      },
      ...SHARED_FAQ_TAIL,
    ],
  },

  {
    slug: "tutores",
    label: "tutores",
    title: "App para tutores académicos en México — Cardigan",
    seoDescription:
      "La app para tutores académicos en México: agenda de tutorías, control de alumnos, mensualidades y notas de avance — en un solo lugar. 30 días gratis.",
    keywords:
      "app tutores académicos méxico, agenda tutorías, control alumnos tutorías, app tutores",
    breadcrumb: "Para tutores",
    hero: {
      eyebrow: "Cardigan para tutores académicos",
      h1: "Tus alumnos, sus avances, tu cobro.",
      lead: "Cardigan reúne agenda de tutorías, control de alumnos, mensualidades y notas de avance para tutores académicos en México. Menos administración, más tiempo enseñando.",
    },
    featuresIntro:
      "Diseñado para tutores. Una materia o varias, en casa, en línea o a domicilio.",
    features: [
      { icon: "calendar", h: "Agenda recurrente", p: "Tutorías semanales, quincenales o flexibles. Cardigan extiende tu calendario y avisa antes de cada sesión." },
      { icon: "users", h: "Cada alumno, una ficha", p: "Materias, avances, ejercicios, datos del padre o tutor — todo organizado por alumno en un mismo lugar." },
      { icon: "dollar", h: "Mensualidades al instante", p: "Cobra por sesión o por mes. Cardigan calcula lo que cada alumno debe y te dice quién está al corriente." },
      { icon: "file", h: "Notas y materiales", p: "Sube exámenes, ejercicios, libros y notas de avance. Disponibles en la ficha del alumno cuando los necesites." },
      { icon: "bell", h: "Recordatorios automáticos", p: "Push antes de cada tutoría. Tu alumno llega preparado, tú no llegas con sorpresas." },
      { icon: "smartphone", h: "Funciona donde tú trabajas", p: "Cardigan vive en tu celular o computadora. Funciona a domicilio, en café, en línea o en tu propio espacio." },
    ],
    phone: {
      kpis: [
        { label: "Tutorías hoy", value: "3", meta: "Hoy", red: false },
        { label: "Alumnos",      value: "16", meta: "14 activos", red: false },
        { label: "Cobrado (Mes)", value: "$14,200", meta: "Mes en curso", red: false },
        { label: "No cobrado",   value: "$1,800",  meta: "2 con saldo",  red: true },
      ],
      sessions: [
        { initials: "MA", patient: "Mateo A.",   time: "16:00 - 17:00", modality: "presencial", status: "scheduled" },
        { initials: "IL", patient: "Isabela L.", time: "17:30 - 18:30", modality: "virtual",    status: "scheduled" },
        { initials: "EG", patient: "Emilio G.",  time: "19:00 - 20:00", modality: "presencial", status: "scheduled" },
      ],
      float: { initials: "MA", patient: "Mateo A.", sub: "Hoy 16:00 · Próxima", badge: "Al día" },
    },
    minis: [
      {
        label: "Tu día de tutorías.",
        kind: "sessions",
        rows: [
          { initials: "MA", patient: "Mateo A.",   time: "16:00 - 17:00", modality: "presencial", status: "scheduled" },
          { initials: "IL", patient: "Isabela L.", time: "17:30 - 18:30", modality: "virtual",    status: "scheduled" },
        ],
      },
      {
        label: "Cada alumno, un toque.",
        kind: "patients",
        rows: [
          { initials: "MA", patient: "Mateo Aguilar",   sub: "Tutor: Roberto A. · $550", badge: "Activo", tutor: true },
          { initials: "IL", patient: "Isabela León",    sub: "$600 por sesión", badge: "Activo", tutor: false },
        ],
      },
      {
        label: "Tu mes, en limpio.",
        kind: "finances",
        kpis: [
          { label: "Cobrado (Mes)", value: "$14,200", meta: "Mes en curso", red: false },
          { label: "No cobrado",    value: "$1,800",  meta: "2 con saldo",  red: true },
        ],
      },
    ],
    steps: [
      { num: 1, label: "Crea tu cuenta" },
      { num: 2, label: "Agrega tu primer alumno" },
      { num: 3, label: "Agenda tu primera tutoría" },
    ],
    faq: [
      {
        q: "¿Puedo manejar alumnos de varias materias?",
        a: "Sí. Cada alumno puede tener varias materias activas y tarifas distintas. Cardigan calcula el saldo de cada uno por separado.",
      },
      {
        q: "¿Sirve para tutorías en línea?",
        a: "Sí. Marca una sesión como virtual y Cardigan la diferencia visualmente. Funciona igual de bien para tutorías presenciales, en línea o a domicilio.",
      },
      {
        q: "¿Puedo registrar al padre o tutor del alumno?",
        a: "Sí. Cuando el alumno es menor de edad puedes capturar al padre o tutor y sus datos quedan en la ficha del alumno. Los recordatorios y cobros se pueden dirigir a su número.",
      },
      ...SHARED_FAQ_TAIL,
    ],
  },
];

/* ── Icons ──
   Inline SVG keyed by name. Same visual language as the in-app
   IconX components — 22px, stroke-only, currentColor. */
const ICON_PATHS = {
  lock:       `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>`,
  calendar:   `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>`,
  dollar:     `<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 7H10a3 3 0 000 6h4a3 3 0 010 6H6"/>`,
  file:       `<path d="M14 3v5h5M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/>`,
  bell:       `<path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9z"/><path d="M10 21a2 2 0 004 0"/>`,
  shield:     `<path d="M12 3l8 4v6c0 5-4 8-8 8s-8-3-8-8V7l8-4z"/>`,
  inbody:     `<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/><circle cx="17" cy="17" r="2"/>`,
  chart:      `<path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="6" rx="1"/><rect x="12" y="7" width="3" height="10" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/>`,
  package:    `<path d="M3 7l9 5 9-5"/><path d="M3 7v10l9 5 9-5V7"/><path d="M12 12v10"/>`,
  smartphone: `<rect x="6" y="2" width="12" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/>`,
  users:      `<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>`,
};

function icon(name, size = 22) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden>${ICON_PATHS[name] || ""}</svg>`;
}

function checkmarkSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
}

/* Shared list of profession-specific siblings for the "¿Eres
   profesionista?" footer cluster. The current page is omitted so a
   visitor doesn't see a redundant link to themselves. */
const FOOTER_SIBLINGS = [
  { slug: "psicologos",         label: "Para psicólogos" },
  { slug: "nutriologos",        label: "Para nutriólogos" },
  { slug: "entrenadores",       label: "Para entrenadores" },
  { slug: "maestros-de-musica", label: "Para maestros de música" },
  { slug: "tutores",            label: "Para tutores" },
];

/* ── Mock renderers ──────────────────────────────────────────── */

function modalityKey(m) { return m === "adomicilio" ? "adomicilio" : (m || "presencial"); }
function modalityLabel(m) {
  if (m === "virtual") return "VIRTUAL";
  if (m === "telefonica") return "TELEFÓNICA";
  if (m === "adomicilio") return "A DOMICILIO";
  return "PRESENCIAL";
}
function statusKey(s) {
  if (s === "completed") return "completed";
  if (s === "cancelled" || s === "charged") return "cancelled";
  return "scheduled";
}
function statusLabel(s) {
  if (s === "completed") return "Completada";
  if (s === "cancelled" || s === "charged") return "Cancelada";
  return "Agendada";
}

function avatarPaletteByInitial(initials) {
  // Deterministic palette mirroring the in-app getClientColor —
  // hash the first letter so the same name always gets the same hue.
  const palette = ["#5B9BAF", "#D4A040", "#3DAB74", "#8B6FB5", "#D96B6B", "#4A8AB5"];
  const i = ((initials || "?").charCodeAt(0) || 0) % palette.length;
  return palette[i];
}

function renderPhone(p) {
  return `
        <div class="mkt-phone-wrap" aria-hidden="true">
          <div class="mkt-float-card">
            <div class="mkt-float-row">
              <span class="mkt-float-av" style="background:${avatarPaletteByInitial(p.float.initials)};color:#fff">${(p.float.initials || "?").charAt(0)}</span>
              <div class="mkt-float-main">
                <div class="mkt-float-name">${p.float.patient}</div>
                <div class="mkt-float-sub">${p.float.sub}</div>
              </div>
              <span class="mkt-float-badge">${p.float.badge}</span>
            </div>
          </div>
          <div class="mkt-phone">
            <div class="mkt-phone-notch"></div>
            <div class="mkt-phone-screen">
              <div class="mkt-phone-status">
                <span>9:41</span>
                <span class="mkt-phone-status-right">
                  <span class="mkt-phone-bar"></span>
                  <span class="mkt-phone-bar mkt-phone-bar--tall"></span>
                  <span class="mkt-phone-bar"></span>
                </span>
              </div>
              <div class="mkt-phone-topbar">
                <div class="mkt-phone-hamburger"><span></span><span></span><span></span></div>
                <div class="mkt-phone-brand">
                  <img src="/icon-mono.svg" alt="" />
                  <span>cardigan</span>
                </div>
                <div class="mkt-phone-topbar-right">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>
                  </svg>
                </div>
              </div>
              <div class="mkt-phone-content">
                <div class="mkt-phone-kpis">
                  ${p.kpis.map(k => `
                    <div class="mkt-phone-kpi">
                      <div class="mkt-phone-kpi-label">${k.label}</div>
                      <div class="mkt-phone-kpi-value${k.red ? " mkt-phone-kpi-value--red" : ""}">${k.value}</div>
                      <div class="mkt-phone-kpi-meta">${k.meta}</div>
                    </div>`).join("")}
                </div>
                <div class="mkt-phone-section-title">Hoy</div>
                <div class="mkt-phone-list">
                  ${p.sessions.map(s => `
                    <div class="mkt-phone-row mkt-phone-row--${statusKey(s.status)}">
                      <div class="mkt-phone-av" style="background:${avatarPaletteByInitial(s.initials)}">${(s.initials || "?").charAt(0)}</div>
                      <div class="mkt-phone-row-main">
                        <div class="mkt-phone-row-title">${s.patient}</div>
                        <div class="mkt-phone-row-sub">
                          <span>${s.time}</span>
                          <span class="mkt-phone-eyebrow mkt-phone-eyebrow--${modalityKey(s.modality)}">${modalityLabel(s.modality)}</span>
                        </div>
                      </div>
                      <span class="mkt-phone-badge mkt-phone-badge--${statusKey(s.status)}">${statusLabel(s.status)}</span>
                    </div>`).join("")}
                </div>
              </div>
              <div class="mkt-phone-fab">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </div>
            </div>
          </div>
        </div>`;
}

function renderMiniSessions(rows) {
  return `<div class="mkt-mini" aria-hidden="true">${rows.map(s => `
            <div class="mkt-mini-row mkt-mini-row--${statusKey(s.status)}">
              <span class="mkt-mini-av" style="background:${avatarPaletteByInitial(s.initials)}">${(s.initials || "?").charAt(0)}</span>
              <div class="mkt-mini-row-main">
                <div class="mkt-mini-row-title">${s.patient}</div>
                <div class="mkt-mini-row-sub">
                  <span>${s.time}</span>
                  <span class="mkt-mini-eyebrow mkt-mini-eyebrow--${modalityKey(s.modality)}">${modalityLabel(s.modality)}</span>
                </div>
              </div>
              <span class="mkt-mini-badge mkt-mini-badge--scheduled">${statusLabel(s.status)}</span>
            </div>`).join("")}</div>`;
}

function renderMiniPatients(rows) {
  return `<div class="mkt-mini" aria-hidden="true">${rows.map(p => `
            <div class="mkt-mini-row">
              <span class="mkt-mini-av" style="background:${p.tutor ? "#8B6FB5" : avatarPaletteByInitial(p.initials)}">${(p.initials || "?").charAt(0)}</span>
              <div class="mkt-mini-row-main">
                <div class="mkt-mini-row-title">${p.patient}</div>
                <div class="mkt-mini-row-sub">${p.tutor ? `<span class="mkt-mini-tutor">TUTOR:</span>` : ""}${p.sub}</div>
              </div>
              <span class="mkt-mini-badge mkt-mini-badge--active">${p.badge || "Activo"}</span>
            </div>`).join("")}</div>`;
}

function renderMiniFinances(kpis) {
  return `<div class="mkt-mini mkt-mini--finances" aria-hidden="true">${kpis.map(k => `
            <div class="mkt-mini-kpi">
              <div class="mkt-mini-kpi-label">${k.label}</div>
              <div class="mkt-mini-kpi-value${k.red ? " mkt-mini-kpi-value--red" : ""}">${k.value}</div>
              <div class="mkt-mini-kpi-meta">${k.meta}</div>
            </div>`).join("")}</div>`;
}

function renderMiniChart(m) {
  // Bar values are 0–100; height as a percentage of the chart area.
  return `<div class="mkt-mini mkt-mini--chart" aria-hidden="true">
            <div class="mkt-chart-head">
              <div class="mkt-chart-title">${m.title}</div>
              <div class="mkt-chart-delta">${m.delta}</div>
            </div>
            <div class="mkt-chart-bars">${m.bars.map(b => `<div class="mkt-chart-bar" style="height:${Math.max(8, Math.min(100, b))}%"></div>`).join("")}</div>
            <div class="mkt-chart-axis">${m.axis.map(a => `<span>${a}</span>`).join("")}</div>
          </div>`;
}

function renderMini(m) {
  if (m.kind === "sessions")  return renderMiniSessions(m.rows);
  if (m.kind === "patients")  return renderMiniPatients(m.rows);
  if (m.kind === "finances")  return renderMiniFinances(m.kpis);
  if (m.kind === "chart")     return renderMiniChart(m);
  return "";
}

function renderFAQJSONLD(faq) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(f => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  }, null, 2);
}

function renderBreadcrumbJSONLD(label, slug) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${CANONICAL}/` },
      { "@type": "ListItem", position: 2, name: label,    item: `${CANONICAL}/${slug}/` },
    ],
  }, null, 2);
}

function renderSoftwareJSONLD(c) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Cardigan",
    operatingSystem: "Web, iOS, Android",
    applicationCategory: "BusinessApplication",
    url: `${CANONICAL}/${c.slug}/`,
    description: c.seoDescription,
    inLanguage: "es-MX",
    offers: {
      "@type": "Offer",
      price: "299",
      priceCurrency: "MXN",
      category: "Subscription",
      availability: "https://schema.org/InStock",
    },
  }, null, 2);
}

function renderPage(c) {
  const url = `${CANONICAL}/${c.slug}/`;
  const heroEyebrow = c.hero.eyebrow;
  const otherSiblings = FOOTER_SIBLINGS.filter(s => s.slug !== c.slug);

  return `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="UTF-8" />
<title>${c.title}</title>
<meta name="description" content="${c.seoDescription}" />
<meta name="keywords" content="${c.keywords}" />
<link rel="canonical" href="${url}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta name="theme-color" content="#FFFFFF" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="es_MX" />
<meta property="og:site_name" content="Cardigan" />
<meta property="og:title" content="${c.title}" />
<meta property="og:description" content="${c.seoDescription}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${CANONICAL}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${c.title}" />
<meta name="twitter:description" content="${c.seoDescription}" />
<meta name="twitter:image" content="${CANONICAL}/og-image.png" />
<script type="application/ld+json">
${renderSoftwareJSONLD(c)}
</script>
<script type="application/ld+json">
${renderFAQJSONLD(c.faq)}
</script>
<script type="application/ld+json">
${renderBreadcrumbJSONLD(c.breadcrumb, c.slug)}
</script>
<link rel="stylesheet" href="/marketing.css" />
</head>
<body>
<div class="mkt-page">
  <header class="mkt-nav" id="mkt-nav">
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
    <!-- Hero — text on the left, phone preview on the right. -->
    <section class="mkt-hero" id="mkt-hero">
      <div class="mkt-container mkt-hero-grid">
        <div class="mkt-hero-copy">
          <span class="mkt-hero-eyebrow">${heroEyebrow}</span>
          <h1>${c.hero.h1}</h1>
          <p class="lead">${c.hero.lead}</p>
          <div class="mkt-hero-cta-row">
            <a href="/" class="mkt-btn-primary">Comenzar gratis</a>
            <a href="#precios" class="mkt-btn-secondary">Ver precios</a>
          </div>
          <div class="mkt-trust">
            <span class="mkt-trust-item">${checkmarkSvg()} 30 días gratis, sin tarjeta</span>
            <span class="mkt-trust-item">${checkmarkSvg()} Cumple LFPDPPP</span>
            <span class="mkt-trust-item">${checkmarkSvg()} Cancela cuando quieras</span>
          </div>
        </div>
        <div class="mkt-hero-visual">
          ${renderPhone(c.phone)}
        </div>
      </div>
    </section>

    <!-- Feature deck -->
    <section class="mkt-features">
      <div class="mkt-container">
        <h2 class="mkt-features-h">Lo necesario, nada más.</h2>
        <p class="mkt-features-sub">${c.featuresIntro}</p>
        <div class="mkt-features-grid">
          ${c.features.map((f, i) => `
          <div class="mkt-feature mkt-reveal" style="--i:${i}">
            <div class="mkt-feature-icon">${icon(f.icon)}</div>
            <h3>${f.h}</h3>
            <p>${f.p}</p>
          </div>`).join("")}
        </div>
      </div>
    </section>

    <!-- Mini-mocks strip — three small slices of the live app. -->
    <section>
      <div class="mkt-container">
        <h2 class="mkt-features-h">Tu trabajo, en tres pantallas.</h2>
        <p class="mkt-features-sub">Lo más usado, siempre a un toque.</p>
        <div class="mkt-minis">
          ${c.minis.map((m, i) => `
          <article class="mkt-mini-card mkt-reveal" style="--i:${i}">
            ${renderMini(m)}
            <div class="mkt-mini-label">${m.label}</div>
          </article>`).join("")}
        </div>
      </div>
    </section>

    <!-- Cómo empezar — 3 steps. -->
    <section class="mkt-start">
      <div class="mkt-container">
        <h2 class="mkt-features-h">Listo en 3 pasos.</h2>
        <p class="mkt-features-sub">Sin instalar nada, sin tarjeta.</p>
        <ol class="mkt-steps">
          ${c.steps.map((s, i) => `
          <li class="mkt-step mkt-reveal" style="--i:${i}">
            <span class="mkt-step-num">${s.num}</span>
            <span class="mkt-step-label">${s.label}</span>
          </li>`).join("")}
        </ol>
      </div>
    </section>

    <!-- Pricing -->
    <section class="mkt-pricing" id="precios">
      <div class="mkt-container">
        <h2 class="mkt-features-h">Un solo precio. Sin sorpresas.</h2>
        <p class="mkt-features-sub">30 días gratis. Después decides.</p>
        <div class="mkt-pricing-card">
          <div class="mkt-pricing-name">Cardigan Pro</div>
          <div class="mkt-pricing-amount"><strong>$299</strong><span>MXN / mes</span></div>
          <div class="mkt-pricing-note">o $2,990 MXN al año (ahorra 17%)</div>
          <ul class="mkt-pricing-list">
            ${SHARED_PRICING_LIST.map(p => `<li>${p}</li>`).join("")}
          </ul>
          <a href="/" class="mkt-btn-primary" style="display:block">Comenzar gratis</a>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section>
      <div class="mkt-container">
        <h2 class="mkt-features-h">Preguntas frecuentes</h2>
        <p class="mkt-features-sub">¿Algo más? <a href="mailto:hola@cardigan.mx">hola@cardigan.mx</a></p>
        <div class="mkt-faq-list">
          ${c.faq.map(f => `
          <details class="mkt-faq">
            <summary>${f.q}</summary>
            <div class="mkt-faq-body">${f.a}</div>
          </details>`).join("")}
        </div>
      </div>
    </section>

    <!-- Closing CTA -->
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
        <div class="mkt-footer-cluster-h">Cardigan</div>
        <ul>
          <li><a href="/">Inicio</a></li>
          <li><a href="/pacientes/">Para pacientes</a></li>
          <li><a href="/blog/">Blog</a></li>
        </ul>
      </div>
      <div class="mkt-footer-cluster">
        <div class="mkt-footer-cluster-h">Por profesión</div>
        <ul>
          ${otherSiblings.map(s => `<li><a href="/${s.slug}/">${s.label}</a></li>`).join("")}
        </ul>
      </div>
      <div class="mkt-footer-cluster">
        <div class="mkt-footer-cluster-h">Soporte</div>
        <ul>
          <li><a href="mailto:hola@cardigan.mx">hola@cardigan.mx</a></li>
          <li><a href="mailto:privacy@cardigan.mx">Privacidad</a></li>
          <li><a href="https://www.instagram.com/cardigan_mex/" target="_blank" rel="noopener noreferrer me">Instagram</a></li>
        </ul>
      </div>
    </div>
    <div class="mkt-footer-bottom">© 2026 Cardigan. Hecho en México con cuidado.</div>
  </footer>
</div>

<!-- Sticky-nav scroll-state + scroll-triggered reveals. Vanilla JS,
     no external dependency. Respects prefers-reduced-motion via the
     CSS guard at the bottom of marketing.css. -->
<script>
(function() {
  var nav = document.getElementById("mkt-nav");
  var hero = document.getElementById("mkt-hero");
  if (nav && hero && "IntersectionObserver" in window) {
    var ioNav = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        nav.classList.toggle("mkt-nav--scrolled", !e.isIntersecting);
      });
    }, { threshold: 0, rootMargin: "-60px 0px 0px 0px" });
    ioNav.observe(hero);
  }
  var reveals = document.querySelectorAll(".mkt-reveal");
  if (reveals.length && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) {
          e.target.classList.add("mkt-in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function(el) { io.observe(el); });
  } else {
    // No IntersectionObserver — show everything immediately.
    reveals.forEach(function(el) { el.classList.add("mkt-in"); });
  }
})();
</script>
</body>
</html>
`;
}

async function build() {
  for (const c of PROFESSIONS) {
    const dir = path.join(PUBLIC_DIR, c.slug);
    await mkdir(dir, { recursive: true });
    const html = renderPage(c);
    await writeFile(path.join(dir, "index.html"), html, "utf8");
    console.log(`✓ wrote /${c.slug}/index.html (${html.length.toLocaleString()} chars)`);
  }
  console.log(`\nDone. ${PROFESSIONS.length} profession pages rebuilt.`);
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
