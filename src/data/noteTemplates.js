export const NOTE_TEMPLATES = [
  {
    id: "blank",
    name: "En blanco",
    icon: "edit",
    title: "",
    content: "",
  },
  {
    id: "soap",
    name: "Nota SOAP",
    icon: "clipboard",
    title: "Nota SOAP",
    content: `# Subjetivo
- Lo que el paciente reporta:

# Objetivo
- Observaciones del terapeuta:

# Análisis
- Interpretación y diagnóstico:

# Plan
- Próximos pasos:
`,
  },
  {
    id: "dap",
    name: "Nota DAP",
    icon: "document",
    title: "Nota DAP",
    content: `# Datos
- Información relevante de la sesión:

# Análisis
- Evaluación clínica:

# Plan
- Intervenciones y seguimiento:
`,
  },
  {
    id: "progress",
    name: "Nota de progreso",
    icon: "check",
    title: "Nota de progreso",
    content: `# Estado actual
- Situación del paciente:

# Avances
- Progreso desde la última sesión:

# Objetivos
- [ ]
- [ ]
- [ ]

# Observaciones
-
`,
  },
  {
    id: "initial",
    name: "Evaluación inicial",
    icon: "user",
    title: "Evaluación inicial",
    content: `# Datos del paciente
- Nombre:
- Edad:
- Motivo de consulta:

# Historia clínica
- Antecedentes relevantes:

# Evaluación
- Observaciones iniciales:

# Plan de tratamiento
- Frecuencia sugerida:
- Objetivos terapéuticos:
- [ ]
- [ ]
`,
  },
];
