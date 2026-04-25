/* Aviso de privacidad — LFPDPPP-compliant.

   Bump POLICY_VERSION + POLICY_PUBLISHED whenever the body changes
   materially. Users whose latest accepted version no longer matches
   are re-prompted on next login via components/ConsentBanner.jsx.

   Legal posture: this document is written to satisfy the
   requirements of the Mexican Ley Federal de Protección de Datos
   Personales en Posesión de los Particulares (LFPDPPP) and its
   Reglamento. Cardigan still recommends running it past a Mexican
   data-privacy lawyer before claiming compliance externally — the
   text below is comprehensive but generated, not formally reviewed.

   Section bodies may contain `\n\n` to render as multiple paragraphs
   in PrivacyPolicy.jsx. */

export const POLICY_VERSION = "2026-04-v2";
export const POLICY_PUBLISHED = "25 de abril de 2026";

export const POLICY_SECTIONS = [
  {
    title: "1. Identidad y domicilio del Responsable",
    body:
      "Cardigan (en adelante, “Cardigan” o “nosotros”) es el servicio de gestión de práctica clínica accesible " +
      "en https://cardigan.mx. El Responsable del tratamiento de los datos personales que se recaban a través de " +
      "este servicio es el titular de Cardigan, con domicilio en los Estados Unidos Mexicanos.\n\n" +
      "Para ejercer cualquier derecho relacionado con tus datos personales, o para resolver dudas sobre el " +
      "presente Aviso de Privacidad, puedes contactarnos en cualquier momento al correo electrónico " +
      "privacy@cardigan.mx. Este es el único canal oficial para asuntos de privacidad y datos personales.",
  },
  {
    title: "2. Datos personales que recabamos",
    body:
      "Los datos personales que tratamos se agrupan en las siguientes categorías:\n\n" +
      "(a) Datos de identificación y contacto del titular de la cuenta: nombre completo, correo electrónico " +
      "y, opcionalmente, fotografía de avatar. La contraseña se almacena exclusivamente como hash " +
      "criptográfico irreversible y nunca tenemos acceso a ella en texto claro.\n\n" +
      "(b) Datos de uso de la aplicación: dirección IP del dispositivo, tipo de navegador, marca de tiempo " +
      "de acceso y eventos de error técnico. Estos datos se generan automáticamente y se utilizan únicamente " +
      "para diagnosticar fallos y mantener la disponibilidad del servicio.\n\n" +
      "(c) Datos de pacientes que tú introduces voluntariamente al expediente: nombre, iniciales, datos de " +
      "contacto del paciente o de su tutor (cuando es menor de edad), tarifa por sesión, fechas y estatus de " +
      "sesiones, montos y métodos de pago, notas clínicas y documentos que subas (PDF, imágenes, etc.).\n\n" +
      "(d) Preferencias de la cuenta: zona horaria, idioma, configuración de notificaciones, modo claro/oscuro " +
      "y tokens de suscripción a notificaciones push del navegador.\n\n" +
      "No recabamos datos de geolocalización precisa, datos biométricos, ni cookies de publicidad o " +
      "analítica de terceros.",
  },
  {
    title: "3. Datos personales sensibles",
    body:
      "Las notas clínicas y la información de salud de los pacientes que tú registras se consideran " +
      "datos personales sensibles bajo la LFPDPPP. Estos datos requieren tu consentimiento expreso para ser " +
      "tratados, el cual se entiende otorgado al momento de capturarlos voluntariamente en la aplicación.\n\n" +
      "Para reforzar la protección de estos datos, Cardigan ofrece —de forma opcional— el cifrado de notas " +
      "clínicas en reposo, mediante una contraseña adicional que tú estableces y que jamás abandona tu " +
      "navegador en texto claro. Cuando el cifrado está activo, las notas almacenadas en nuestra base de " +
      "datos quedan protegidas incluso ante un acceso no autorizado a la infraestructura subyacente.",
  },
  {
    title: "4. Finalidades del tratamiento",
    body:
      "Finalidades primarias (necesarias para prestarte el servicio):\n\n" +
      "• Crear y autenticar tu cuenta de usuario.\n" +
      "• Almacenar, mostrar y permitirte editar la información de tus pacientes, sesiones, pagos, notas y " +
      "documentos.\n" +
      "• Enviar correos transaccionales (verificación de cuenta, recuperación de contraseña, alertas " +
      "técnicas).\n" +
      "• Enviar recordatorios de sesión vía notificación push, cuando los actives.\n" +
      "• Cumplir obligaciones legales aplicables (atención a requerimientos de autoridad competente).\n\n" +
      "Finalidades secundarias (no necesarias para el servicio):\n\n" +
      "• Análisis estadístico agregado y anonimizado para mejorar la experiencia del producto.\n\n" +
      "Si no deseas que tus datos se traten para las finalidades secundarias, puedes manifestarlo en cualquier " +
      "momento escribiendo a privacy@cardigan.mx. La negativa para estas finalidades no condiciona la " +
      "prestación del servicio.\n\n" +
      "No vendemos, alquilamos ni compartimos tus datos con terceros para fines de mercadotecnia, " +
      "publicidad o prospección comercial.",
  },
  {
    title: "5. Doble rol: tú como Responsable de los datos de tus pacientes",
    body:
      "Respecto de los datos de tu cuenta de usuario (nombre, correo, contraseña, preferencias), Cardigan " +
      "actúa como Responsable conforme a este Aviso.\n\n" +
      "Respecto de los datos de tus pacientes que tú registras en la aplicación, tú eres el Responsable y " +
      "Cardigan actúa como Encargado del tratamiento. Esto significa que:\n\n" +
      "• Tú eres responsable de obtener el consentimiento de tus pacientes (o de sus tutores legales en el " +
      "caso de menores) para registrar y tratar sus datos personales y datos sensibles de salud.\n" +
      "• Tú eres responsable de poner a disposición de tus pacientes tu propio Aviso de Privacidad, conforme " +
      "a la LFPDPPP y demás regulaciones aplicables a tu profesión.\n" +
      "• Cardigan únicamente trata los datos de tus pacientes siguiendo tus instrucciones (lectura, " +
      "escritura, eliminación), no los utiliza para finalidades propias y no los transfiere a terceros " +
      "más allá de los proveedores de infraestructura necesarios para operar el servicio (sección 6).",
  },
  {
    title: "6. Transferencias y proveedores de servicio",
    body:
      "Para operar la aplicación recurrimos a los siguientes proveedores, quienes actúan como " +
      "subencargados y procesan únicamente la información estrictamente necesaria para sus funciones:\n\n" +
      "• Supabase, Inc. (Estados Unidos de América) — base de datos PostgreSQL, autenticación de usuarios y " +
      "almacenamiento de tokens.\n" +
      "• Cloudflare, Inc. (Estados Unidos de América) — almacenamiento de documentos en buckets R2 y " +
      "administración de DNS.\n" +
      "• Vercel, Inc. (Estados Unidos de América) — hospedaje del frontend y de las funciones serverless.\n" +
      "• Resend (Estados Unidos de América) — envío de correos transaccionales (verificación, recuperación " +
      "de contraseña).\n" +
      "• Sentry (Functional Software, Inc., Estados Unidos de América) — captura de errores técnicos para " +
      "diagnóstico (los errores se filtran de cualquier dato personal o de paciente antes de salir del " +
      "navegador).\n" +
      "• Google LLC y Apple Inc. — entrega de notificaciones push, únicamente cuando hayas habilitado los " +
      "recordatorios y a través de los servicios estándar de tu sistema operativo.\n\n" +
      "Algunas de estas transferencias implican el envío de datos personales fuera de los Estados Unidos " +
      "Mexicanos. Estos proveedores cuentan con cláusulas contractuales y medidas de seguridad acordes con " +
      "las exigencias de la LFPDPPP. Al utilizar Cardigan otorgas tu consentimiento para estas " +
      "transferencias en los términos descritos.\n\n" +
      "No realizamos transferencias adicionales a terceros sin tu consentimiento expreso, salvo en los " +
      "supuestos previstos en el artículo 37 de la LFPDPPP (por ejemplo, requerimiento de autoridad " +
      "competente).",
  },
  {
    title: "7. Medidas de seguridad",
    body:
      "Implementamos medidas técnicas, administrativas y físicas razonables para proteger tus datos contra " +
      "pérdida, uso indebido, acceso no autorizado, alteración o divulgación. Entre estas medidas se " +
      "encuentran:\n\n" +
      "• Cifrado de datos en tránsito mediante TLS 1.2 o superior en todas las conexiones.\n" +
      "• Almacenamiento de contraseñas únicamente como hash criptográfico irreversible (bcrypt).\n" +
      "• Aislamiento de datos a nivel de base de datos mediante Row-Level Security: cada usuario sólo " +
      "puede leer y modificar la información asociada a su propia cuenta.\n" +
      "• Cifrado opcional de notas clínicas en reposo, controlado por una contraseña que jamás abandona " +
      "tu navegador en texto claro.\n" +
      "• Documentos almacenados en buckets privados con URLs firmadas de corta duración (≤ 1 hora).\n" +
      "• Registro y monitoreo de errores con filtrado automático de datos personales antes de salir del " +
      "navegador.\n" +
      "• Acceso administrativo a la infraestructura limitado, autenticado y auditado.\n\n" +
      "Ninguna medida de seguridad es infalible. Si detectamos una vulneración de seguridad que afecte " +
      "de forma significativa tus derechos patrimoniales o morales, te lo notificaremos sin demora a través " +
      "del correo electrónico asociado a tu cuenta, conforme al artículo 20 de la LFPDPPP.",
  },
  {
    title: "8. Conservación de los datos",
    body:
      "Conservamos tus datos mientras tu cuenta permanezca activa. Al solicitar la eliminación de tu cuenta, " +
      "todos los registros asociados (información de pacientes, sesiones, pagos, notas, documentos, " +
      "preferencias y suscripciones de notificación) se borran de forma irreversible dentro de las 72 horas " +
      "posteriores a la solicitud.\n\n" +
      "Conservamos únicamente, por razones de auditoría y prevención de fraude, una huella mínima de " +
      "eliminación: la fecha en que se procesó la baja y un hash de tu correo electrónico, sin nombres ni " +
      "datos clínicos.\n\n" +
      "Las copias de respaldo cifradas pueden contener tus datos por un periodo adicional máximo de 30 días " +
      "antes de ser sobrescritas conforme al ciclo natural de retención de la base de datos.",
  },
  {
    title: "9. Tus derechos ARCO",
    body:
      "En todo momento puedes ejercer los derechos de Acceso, Rectificación, Cancelación y Oposición " +
      "(derechos ARCO) respecto de tus datos personales:\n\n" +
      "• Acceso: descarga una copia completa de tus datos en formato JSON desde Ajustes → Privacidad → " +
      "Descargar mis datos. Esta operación está limitada a una solicitud por hora.\n" +
      "• Rectificación: edita en cualquier momento la información de tu perfil, pacientes, sesiones, pagos " +
      "y notas desde las pantallas correspondientes de la aplicación.\n" +
      "• Cancelación: elimina tu cuenta y todos los datos asociados desde Ajustes → Zona peligrosa → " +
      "Eliminar mi cuenta. La eliminación es definitiva.\n" +
      "• Oposición: para oponerte a finalidades secundarias o a transferencias específicas, escribe a " +
      "privacy@cardigan.mx con el asunto “Derechos ARCO”.\n\n" +
      "Para solicitudes que no puedas resolver desde la aplicación, escribe a privacy@cardigan.mx desde el " +
      "correo asociado a tu cuenta, indicando: (i) tu nombre y correo registrado, (ii) el derecho que " +
      "deseas ejercer, (iii) una descripción clara y precisa de los datos involucrados, y (iv) cualquier " +
      "elemento que facilite la localización de la información. Te responderemos en un plazo máximo de " +
      "20 días hábiles, conforme al artículo 32 de la LFPDPPP.",
  },
  {
    title: "10. Limitación del uso o divulgación",
    body:
      "Puedes solicitar limitar el uso o divulgación de tus datos personales escribiendo a " +
      "privacy@cardigan.mx. Una vez recibida la solicitud, restringiremos el tratamiento conforme a tu " +
      "petición, salvo en los casos en que la ley nos obligue a continuar tratándolos.",
  },
  {
    title: "11. Revocación del consentimiento",
    body:
      "Tu consentimiento para el tratamiento de tus datos personales puede ser revocado en cualquier " +
      "momento, sin efectos retroactivos. La revocación se ejerce mediante la eliminación de tu cuenta " +
      "(que cancela todo tratamiento) o mediante una solicitud por escrito a privacy@cardigan.mx.\n\n" +
      "La revocación del consentimiento puede impedir, según el caso, la continuación de la prestación del " +
      "servicio o la conclusión de la relación contigo.",
  },
  {
    title: "12. Cookies y tecnologías similares",
    body:
      "Cardigan utiliza almacenamiento local del navegador (localStorage, sessionStorage, IndexedDB y " +
      "cookies estrictamente necesarias) exclusivamente para mantener tu sesión iniciada, recordar tus " +
      "preferencias de interfaz y permitir el funcionamiento offline de la aplicación como Progressive " +
      "Web App.\n\n" +
      "No utilizamos cookies ni tecnologías de rastreo con fines publicitarios, de perfilamiento o de " +
      "analítica de terceros.\n\n" +
      "Puedes deshabilitar el almacenamiento local desde la configuración de tu navegador, en cuyo caso " +
      "algunas funciones (sesión persistente, modo offline) dejarán de operar.",
  },
  {
    title: "13. Datos de menores de edad",
    body:
      "Cardigan no está dirigido a menores de edad. La aplicación es utilizada por profesionales de la " +
      "salud mayores de edad para la gestión de su práctica.\n\n" +
      "Cuando un paciente registrado por el profesional sea menor de edad, los datos del menor son " +
      "ingresados por el profesional bajo su responsabilidad. El profesional debe obtener el consentimiento " +
      "previo del padre, madre o tutor legal del menor antes de registrar cualquier dato. Cardigan, como " +
      "Encargado, no recaba esta información directamente del menor.",
  },
  {
    title: "14. Cambios al Aviso de Privacidad",
    body:
      "Nos reservamos el derecho de actualizar este Aviso de Privacidad cuando cambien las finalidades " +
      "del tratamiento, los proveedores involucrados, los requisitos legales aplicables o las condiciones " +
      "del servicio.\n\n" +
      "Cualquier modificación material será notificada mediante un mensaje al iniciar sesión en la " +
      "aplicación, donde te pediremos aceptar la nueva versión. La fecha de última actualización y el " +
      "número de versión vigente aparecen al inicio de este documento.",
  },
  {
    title: "15. Autoridad competente",
    body:
      "Si consideras que tu derecho a la protección de datos personales ha sido vulnerado por alguna " +
      "conducta u omisión de nuestra parte, o si presumes alguna violación a las disposiciones de la " +
      "LFPDPPP, su Reglamento o demás ordenamientos aplicables, puedes presentar la denuncia o queja " +
      "correspondiente ante el Instituto Nacional de Transparencia, Acceso a la Información y Protección " +
      "de Datos Personales (INAI). Para mayor información, visita https://home.inai.org.mx.",
  },
  {
    title: "16. Aceptación",
    body:
      "Al utilizar Cardigan, manifiestas que leíste, entendiste y aceptas los términos y condiciones del " +
      "presente Aviso de Privacidad. En caso de no estar de acuerdo, te pedimos abstenerte de utilizar el " +
      "servicio.",
  },
];
