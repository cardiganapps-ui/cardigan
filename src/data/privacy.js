/* Aviso de privacidad — LFPDPPP-compliant scaffolding.
   Bump POLICY_VERSION when the body below changes materially; users
   with an older accepted version will be re-prompted on next login.
   Keep the PUBLISHED date in sync with the version bump. */

export const POLICY_VERSION = "2026-04-v1";
export const POLICY_PUBLISHED = "24 de abril de 2026";

export const POLICY_SECTIONS = [
  {
    title: "Responsable del tratamiento",
    body:
      "Cardigan es un producto independiente operado por el responsable del dominio cardigan.mx. " +
      "Cualquier solicitud relacionada con este aviso puede dirigirse a privacy@cardigan.mx.",
  },
  {
    title: "Datos recabados",
    body:
      "Al crear una cuenta recabamos tu nombre completo, correo electrónico y contraseña cifrada. " +
      "Durante el uso del servicio recabamos y almacenamos los datos que tú introduces voluntariamente: " +
      "información de pacientes y tutores, fechas y estatus de sesiones, montos y métodos de pago, " +
      "notas clínicas y documentos que subas al expediente. No recabamos datos de geolocalización ni " +
      "información biométrica.",
  },
  {
    title: "Finalidades del tratamiento",
    body:
      "Usamos tus datos exclusivamente para prestarte el servicio: mostrar tu agenda, calcular saldos, " +
      "recordatorios por notificación push, y resguardo de tu expediente. No vendemos ni compartimos tus " +
      "datos con terceros con fines de mercadotecnia. Los datos de tus pacientes son tuyos y sólo tú tienes " +
      "acceso a ellos dentro de la aplicación.",
  },
  {
    title: "Transferencias a terceros",
    body:
      "Para operar la aplicación utilizamos los siguientes proveedores de servicios, los cuales sólo procesan " +
      "la información estrictamente necesaria: Supabase (base de datos y autenticación), Cloudflare R2 " +
      "(almacenamiento de documentos), Vercel (hospedaje), y Resend (correos de verificación). Todos operan " +
      "con acuerdos de confidencialidad y medidas de seguridad estándar de la industria.",
  },
  {
    title: "Medidas de seguridad",
    body:
      "Los datos se transmiten cifrados en tránsito (TLS). Las contraseñas se almacenan con hash irreversible. " +
      "El acceso a los datos está protegido por Row-Level Security a nivel de base de datos, lo que significa " +
      "que cada usuario sólo puede leer los datos que le pertenecen. Los documentos se almacenan en buckets " +
      "privados con URLs firmadas de corta duración.",
  },
  {
    title: "Derechos ARCO",
    body:
      "Tienes derecho a Acceder, Rectificar, Cancelar u Oponerte al tratamiento de tus datos. Dentro de la " +
      "aplicación puedes: (A) descargar todos tus datos desde Ajustes → Privacidad → Descargar mis datos; " +
      "(R) editar cualquier dato desde las pantallas correspondientes; (C) eliminar tu cuenta y todos sus " +
      "datos de manera permanente desde Ajustes → Privacidad → Eliminar mi cuenta; (O) oponerte al " +
      "tratamiento escribiendo a privacy@cardigan.mx.",
  },
  {
    title: "Conservación de los datos",
    body:
      "Conservamos tus datos mientras mantengas la cuenta activa. Al eliminar tu cuenta, todos los registros " +
      "asociados (pacientes, sesiones, pagos, notas, documentos) se borran de forma irreversible dentro de " +
      "las 72 horas posteriores. Se conservan únicamente los tombstones técnicos (fecha de eliminación y " +
      "dirección de correo) por razones de auditoría y prevención de fraude.",
  },
  {
    title: "Cambios al aviso",
    body:
      "Actualizamos este aviso cuando cambian las finalidades o los proveedores involucrados. Te pediremos " +
      "aceptar la nueva versión al iniciar sesión después de cualquier cambio relevante.",
  },
];
