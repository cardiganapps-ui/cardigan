/* Maestro de música note templates. Designed for at-home / studio music
   teachers tracking repertoire, technique, recital prep, and
   parent-facing progress. Markdown shape mirrors the psychologist set so
   the editor renders identically. */
export const MUSIC_TEACHER_TEMPLATES = [
  {
    id: "blank",
    name: "En blanco",
    icon: "edit",
    title: "",
    content: "",
  },
  {
    id: "initial",
    name: "Diagnóstico inicial",
    icon: "user",
    title: "Diagnóstico inicial",
    content: `# Datos del alumno
- Nombre:
- Edad:
- Instrumento:
- Nivel actual (principiante / intermedio / avanzado):

# Antecedentes musicales
- Estudios previos:
- Lectura de partitura:
- Repertorio que ya domina:

# Objetivos del alumno o tutor
- [ ]
- [ ]

# Plan de trabajo
- Frecuencia sugerida:
- Materiales / método:
- Primera pieza objetivo:
`,
  },
  {
    id: "repertoire",
    name: "Repertorio actual",
    icon: "document",
    title: "Repertorio",
    content: `# Pieza en curso
- Título:
- Compositor:
- Tonalidad / nivel:

# Secciones trabajadas
- [ ]
- [ ]
- [ ]

# Pendientes técnicos
- Articulación:
- Dinámica:
- Tempo objetivo:

# Pieza siguiente sugerida
-
`,
  },
  {
    id: "technique",
    name: "Técnica",
    icon: "check",
    title: "Sesión de técnica",
    content: `# Calentamiento
- Escalas / arpegios trabajados:
- Velocidad metrónomo:

# Ejercicios
- [ ]
- [ ]

# Áreas a reforzar
-

# Tarea para casa
- Minutos sugeridos / día:
-
`,
  },
  {
    id: "recital",
    name: "Preparación de recital",
    icon: "clipboard",
    title: "Preparación de recital",
    content: `# Recital
- Fecha:
- Lugar:
- Pieza(s):

# Plan de ensayo
- [ ] Memorización
- [ ] Tempo final
- [ ] Pasaje crítico (compases):
- [ ] Ensayo en escenario

# Vestimenta / logística
-

# Resultado y notas posteriores
-
`,
  },
];
