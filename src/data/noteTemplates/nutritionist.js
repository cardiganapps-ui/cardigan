/* Nutritionist note templates. Designed for diet/health practitioners:
   initial intake, eating-pattern check-in, weight tracking, and meal-plan
   blueprint. Markdown shape mirrors the psychologist set so the editor
   renders identically. */
export const NUTRITIONIST_TEMPLATES = [
  {
    id: "blank",
    name: "En blanco",
    icon: "edit",
    title: "",
    content: "",
  },
  {
    id: "initial",
    name: "Consulta inicial",
    icon: "user",
    title: "Consulta inicial",
    content: `# Datos del paciente
- Nombre:
- Edad:
- Estatura:
- Peso inicial:
- Objetivo:

# Historia clínica
- Antecedentes médicos relevantes:
- Medicamentos:
- Alergias o intolerancias:

# Hábitos alimenticios actuales
- Comidas al día:
- Líquidos al día:
- Actividad física:

# Plan
- Frecuencia de seguimiento:
- Objetivos para la próxima consulta:
- [ ]
- [ ]
`,
  },
  {
    id: "followup",
    name: "Seguimiento",
    icon: "check",
    title: "Seguimiento",
    content: `# Mediciones
- Peso actual:
- % Grasa / cintura:
- Δ desde la última consulta:

# Apego al plan
- Cumplimiento estimado (%):
- Comidas que costaron más:

# Observaciones
-

# Ajustes para el siguiente período
- [ ]
- [ ]
`,
  },
  {
    id: "mealplan",
    name: "Plan alimenticio",
    icon: "document",
    title: "Plan alimenticio",
    content: `# Distribución diaria
- Calorías objetivo:
- Macros (P / G / C):

# Desayuno
-

# Colación AM
-

# Comida
-

# Colación PM
-

# Cena
-

# Recomendaciones
-
`,
  },
  {
    id: "weight",
    name: "Registro de peso",
    icon: "clipboard",
    title: "Registro de peso",
    content: `# Mediciones
- Fecha:
- Peso (kg):
- Cintura (cm):
- Cadera (cm):

# Comentarios
-

# Tendencia
- Δ semana:
- Δ mes:
`,
  },
];
