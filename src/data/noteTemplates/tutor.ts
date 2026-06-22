/* Tutor (profesor particular) note templates. Designed for after-school
   tutors managing student progress, homework, and exam prep. Markdown
   shape mirrors the psychologist set so the editor renders identically. */
export const TUTOR_TEMPLATES = [
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
- Edad / grado escolar:
- Materia(s):
- Escuela:

# Nivel actual
- Fortalezas:
- Áreas de oportunidad:
- Resultado de evaluación inicial:

# Objetivos del periodo
- [ ]
- [ ]
- [ ]

# Plan de trabajo
- Frecuencia sugerida:
- Materiales:
`,
  },
  {
    id: "progress",
    name: "Reporte de progreso",
    icon: "check",
    title: "Reporte de progreso",
    content: `# Tema de la clase
-

# Avances desde la última clase
-

# Conceptos dominados
- [ ]
- [ ]

# Conceptos por reforzar
- [ ]
- [ ]

# Comentarios para el padre/madre
-
`,
  },
  {
    id: "homework",
    name: "Tarea asignada",
    icon: "document",
    title: "Tarea asignada",
    content: `# Tarea
- Tema:
- Ejercicios / páginas:
- Fecha de entrega:

# Recursos
-

# Notas
-
`,
  },
  {
    id: "exam",
    name: "Preparación de examen",
    icon: "clipboard",
    title: "Preparación de examen",
    content: `# Examen
- Materia / módulo:
- Fecha:
- Temas que cubre:

# Plan de repaso
- [ ]
- [ ]
- [ ]

# Áreas críticas
-

# Resultado (al recibir calificación)
-
`,
  },
];
