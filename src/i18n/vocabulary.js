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

   Forms (s/p/art/artP are authored, the rest are derived):
     s    = singular noun                      ("paciente", "consulta")
     p    = plural noun                        ("pacientes", "consultas")
     art  = singular article                   ("el", "la")
     artP = plural article                     ("los", "las")
     del  = "de + el = del" contraction        ("del paciente", "de la consulta")
     al   = "a + el = al" contraction          ("al paciente", "a la consulta")
     delP = plural form of `del`               ("de los pacientes", "de las consultas")
     alP  = plural form of `al`                ("a los pacientes", "a las consultas")

   The contracted forms include the noun on purpose — Spanish writers
   never split "del" from the noun mentally, so callers should write
   "...{client.del}..." rather than "...{client.delArt} {client.s}...".
   Keeps grammar correct even if a future profession picks a feminine
   client noun (where "del cliente" → "de la cliente").
*/

import { DEFAULT_PROFESSION } from "../data/constants";

function noun(s, p, art, artP) {
  // de + el → del; a + el → al. Other articles don't contract.
  const del  = art  === "el"  ? `del ${s}`  : `de ${art} ${s}`;
  const al   = art  === "el"  ? `al ${s}`   : `a ${art} ${s}`;
  // Plural articles never contract with de/a.
  const delP = `de ${artP} ${p}`;
  const alP  = `a ${artP} ${p}`;
  // Article + noun, ready to drop into a sentence as the subject.
  // "{rate.withArt} cambia mañana" → "los Honorarios cambia mañana"
  // / "la Colegiatura cambia mañana" / "la Tarifa cambia mañana".
  // Cap variant ("Los Honorarios", "La Colegiatura") capitalises both
  // article and noun for sentence-start use.
  const withArt   = `${art} ${s}`;
  const withArtP  = `${artP} ${p}`;
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const WithArt  = `${cap(art)} ${cap(s)}`;
  const WithArtP = `${cap(artP)} ${cap(p)}`;
  // Gender-agreement helpers — derived from the singular article. Spanish
  // adjectives like "primero/primera" need to agree with the noun they
  // modify, so callers that write "tu {session.first} {session.s}" get
  // "tu primera sesión" for fem. nouns and "tu primer entrenamiento"
  // (apocopated) for masc. nouns. Both lower- and upper-case shapes
  // exposed for sentence-start / mid-sentence use.
  const isFem = art === "la" || art === "las";
  const first  = isFem ? "primera" : "primer";
  const First  = cap(first);
  // Past-participle agreement ("modificado/a" — for "Honorarios
  // modificados", "Tarifa modificada", etc.). Drives the rate-changed
  // toasts. Caller picks `agreed` (matches singular) or `agreedP`
  // (matches plural). For Honorarios (s and p both "Honorarios"
  // grammatically plural) callers use agreedP.
  const agreed  = isFem ? "a" : "o";
  const agreedP = isFem ? "as" : "os";
  return {
    s, p, art, artP, del, al, delP, alP,
    withArt, withArtP, WithArt, WithArtP,
    first, First, agreed, agreedP,
  };
}

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
