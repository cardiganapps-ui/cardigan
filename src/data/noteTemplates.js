export const NOTE_TEMPLATES = [
  {
    id: "blank",
    name: "En blanco",
    icon: "📝",
    title: "",
    content: "",
  },
  {
    id: "soap",
    name: "Nota SOAP",
    icon: "🩺",
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
    icon: "📋",
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
    icon: "📈",
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
    icon: "📄",
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
