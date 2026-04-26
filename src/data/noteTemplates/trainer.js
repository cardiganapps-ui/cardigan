/* Entrenador personal note templates. Designed for personal trainers
   tracking client baselines, programmed routines, body measurements,
   and session-by-session progress. Markdown shape mirrors the
   psychologist set so the editor renders identically. */
export const TRAINER_TEMPLATES = [
  {
    id: "blank",
    name: "En blanco",
    icon: "edit",
    title: "",
    content: "",
  },
  {
    id: "initial",
    name: "Evaluación inicial",
    icon: "user",
    title: "Evaluación inicial",
    content: `# Datos del cliente
- Nombre:
- Edad:
- Estatura:
- Peso inicial:
- Objetivo principal:

# Antecedentes
- Lesiones / cirugías:
- Restricciones médicas:
- Experiencia previa con entrenamiento:

# Mediciones de partida
- IMC:
- % Grasa estimado:
- Cintura / cadera:

# Pruebas funcionales
- Sentadilla (reps a 60% RM):
- Plancha (segundos):
- Cardio test (1 km / FC):

# Plan inicial
- Frecuencia semanal:
- Duración por sesión:
- Hitos (4 / 8 / 12 semanas):
`,
  },
  {
    id: "routine",
    name: "Rutina del día",
    icon: "document",
    title: "Rutina",
    content: `# Bloque
- Fase del programa:
- Enfoque (fuerza / hipertrofia / resistencia / movilidad):

# Calentamiento
- 5–10 min:
-

# Ejercicios principales
- 1) Ejercicio — series x reps @ peso / RPE:
- 2) Ejercicio — series x reps @ peso / RPE:
- 3) Ejercicio — series x reps @ peso / RPE:
- 4) Ejercicio — series x reps @ peso / RPE:

# Accesorios
-

# Cardio / cierre
-

# Notas
-
`,
  },
  {
    id: "measurements",
    name: "Mediciones",
    icon: "clipboard",
    title: "Mediciones",
    content: `# Fecha
-

# Mediciones
- Peso (kg):
- Cintura (cm):
- Cadera (cm):
- Bíceps relajado / contraído (cm):
- Muslo (cm):
- % Grasa estimado:

# Foto de progreso
- [ ] Frente
- [ ] Lateral
- [ ] Espalda

# Comentarios
-
`,
  },
  {
    id: "progress",
    name: "Reporte de progreso",
    icon: "check",
    title: "Reporte de progreso",
    content: `# Período revisado
-

# Adherencia
- Sesiones completadas / programadas:
- Cumplimiento del plan nutricional (si aplica):

# Cargas
- Sentadilla:
- Press de banca:
- Peso muerto:

# Logros
-

# Áreas a reforzar
-

# Ajustes para el próximo bloque
- [ ]
- [ ]
`,
  },
];
