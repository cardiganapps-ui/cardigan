/* ── Profession vocabulary primitives ──
   Each profession owns a small set of nouns/articles that the rest of
   the i18n system substitutes into strings via {noun.s} / {noun.p}
   placeholders. This lets future strings branch on profession without
   forcing a 5x duplication of es.js — only nouns vary across professions,
   the surrounding sentence structure stays the same.

   Phase 1 (foundation) ships the resolver + this map. The existing es.js
   strings still hardcode "paciente / sesión / expediente" — those get
   rewritten to use placeholders incrementally per phase (Nutritionist
   first, then Tutor, then Music, then Trainer).

   IMPORTANT: keys must match PROFESSION values in src/data/constants.js
   AND the user_profiles.profession check constraint in
   supabase/schema.sql / migrations/021_user_profiles.sql.

   Each entry has the same shape so callers can rely on the keys existing
   without per-profession defensiveness. Articles are Spanish-gendered
   (el/la, los/las) and need to match the noun's grammatical gender.

   Forms:
     s   = singular noun         ("paciente", "consulta")
     p   = plural noun           ("pacientes", "consultas")
     art = singular article      ("el", "la")
     artP= plural article        ("los", "las")
*/

import { DEFAULT_PROFESSION } from "../data/constants";

const noun = (s, p, art, artP) => ({ s, p, art, artP });

export const VOCAB = {
  psychologist: {
    client:       noun("paciente",     "pacientes",     "el", "los"),
    session:      noun("sesión",  "sesiones",      "la", "las"),
    record:       noun("expediente",   "expedientes",   "el", "los"),
    rate:         noun("Honorarios",   "Honorarios",    "los","los"),
    minorContact: noun("tutor",        "tutores",       "el", "los"),
  },
  nutritionist: {
    client:       noun("paciente",     "pacientes",     "el", "los"),
    session:      noun("consulta",     "consultas",     "la", "las"),
    record:       noun("historial",    "historiales",   "el", "los"),
    rate:         noun("Honorarios",   "Honorarios",    "los","los"),
    minorContact: noun("tutor",        "tutores",       "el", "los"),
  },
  tutor: {
    client:       noun("alumno",       "alumnos",       "el", "los"),
    session:      noun("clase",        "clases",        "la", "las"),
    record:       noun("bitácora","bitácoras","la", "las"),
    rate:         noun("Colegiatura",  "Colegiatura",   "la", "las"),
    minorContact: noun("padre/madre",  "padres",        "el", "los"),
  },
  music_teacher: {
    client:       noun("alumno",       "alumnos",       "el", "los"),
    session:      noun("clase",        "clases",        "la", "las"),
    record:       noun("bitácora","bitácoras","la", "las"),
    rate:         noun("Colegiatura",  "Colegiatura",   "la", "las"),
    minorContact: noun("padre/madre",  "padres",        "el", "los"),
  },
  trainer: {
    client:       noun("cliente",      "clientes",      "el", "los"),
    session:      noun("entrenamiento","entrenamientos","el", "los"),
    record:       noun("historial",    "historiales",   "el", "los"),
    rate:         noun("Tarifa",       "Tarifas",       "la", "las"),
    minorContact: noun("tutor",        "tutores",       "el", "los"),
  },
};

export function getVocab(profession) {
  return VOCAB[profession] ?? VOCAB[DEFAULT_PROFESSION];
}
