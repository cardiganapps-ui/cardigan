import { IconUsers, IconCamera, IconPhone, IconHome } from "../../../components/Icons";
import { shortDateToISO } from "../../../utils/dates";

// Field/discipline nouns — gender-neutral. Mirrors PROVIDER_LABELS
// in PatientClaimScreen / IntakeFormSheet / useAuth. Practitioner
// nouns ("psicóloga", "nutrióloga") would force a gender assumption
// the patient may not even know is wrong; the field name is what's
// relevant for the relationship.
export const PROFESSION_LABEL = {
  psychologist:  "psicología",
  nutritionist:  "nutrición",
  trainer:       "entrenamiento personal",
  music_teacher: "clases de música",
  tutor:         "tutoría",
};

// Profession-themed accent palette. Each profession gets its own
// soft gradient + accent color used in the hero banner, modality
// chip, and therapist avatar so the patient's portal reads as
// "this is my [psychology / nutrition / etc.] space" rather than
// a generic page. The accent colors are pulled from the existing
// design tokens — psychology = teal (the brand default), nutrition
// = green, trainer = amber, music = purple, tutor = rose. Keeps
// the visual identity consistent with the therapist-side styling
// for tutor/interview/etc. */
export const PROFESSION_THEME = {
  psychologist:  { accent: "var(--teal)",   accentDark: "var(--teal-dark)",   accentPale: "var(--teal-pale)",   accentMist: "var(--teal-mist)" },
  nutritionist:  { accent: "var(--green)",  accentDark: "#2D7A52",            accentPale: "var(--green-bg)",     accentMist: "var(--green-bg)" },
  trainer:       { accent: "var(--amber)",  accentDark: "#A37C26",            accentPale: "var(--amber-bg)",     accentMist: "var(--amber-bg)" },
  music_teacher: { accent: "var(--purple)", accentDark: "#5E5495",            accentPale: "var(--purple-bg)",    accentMist: "var(--purple-bg)" },
  tutor:         { accent: "var(--rose)",   accentDark: "#A66480",            accentPale: "var(--rose-bg)",      accentMist: "var(--rose-bg)" },
};

export const MODALITY_LABEL = {
  presencial: "Presencial",
  virtual: "Virtual",
  telefonica: "Telefónica",
  "a-domicilio": "A domicilio",
};

// Modality glyphs — a lightweight visual cue paired with the text
// label so the next-session card reads quickly even before the eye
// reaches the pill text. Falls back to IconUsers (presencial-style)
// for any unknown modality. Colors come from base.css's
// --modality-* tokens to match the agenda surface.
export const MODALITY_ICON = {
  presencial:    IconUsers,
  virtual:       IconCamera,
  telefonica:    IconPhone,
  "a-domicilio": IconHome,
};
export const MODALITY_COLOR = {
  presencial:    "var(--modality-presencial)",
  virtual:       "var(--modality-virtual)",
  telefonica:    "var(--modality-telefonica)",
  "a-domicilio": "var(--modality-a-domicilio)",
};

export const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const MONTH_NAMES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

export const STATUS_LABEL = {
  scheduled: "Programada",
  completed: "Asistió",
  cancelled: "Cancelada",
  charged: "Cobrada",
};
export const STATUS_COLOR = {
  scheduled: "var(--teal-dark)",
  completed: "var(--green)",
  cancelled: "var(--charcoal-xl)",
  charged: "var(--amber, #E8B86C)",
};

export function dayName(iso) {
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return DAY_NAMES[d.getDay()];
}

// Convert a session (date + time strings) to absolute ms timestamp,
// then format the delta to "now" as a human countdown phrase.
// Returns null when the session is in the past so callers can
// hide the chip cleanly. The "ya casi" / "en unos minutos" copy
// reads warmer than a raw count when the gap is < 1h.
export function formatCountdown(iso, time) {
  if (!iso) return null;
  const [h = "0", m = "0"] = (time || "00:00").split(":");
  const target = new Date(`${iso}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`).getTime();
  if (!Number.isFinite(target)) return null;
  const delta = target - Date.now();
  if (delta < 0) return null;
  const minutes = Math.floor(delta / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 5) return "ya casi";
  if (minutes < 60) return `en ${minutes} min`;
  if (hours < 24) return hours === 1 ? "en 1 hora" : `en ${hours} horas`;
  if (days < 7) return days === 1 ? "mañana" : `en ${days} días`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return weeks === 1 ? "en 1 semana" : `en ${weeks} semanas`;
  const months = Math.floor(days / 30);
  return months === 1 ? "en 1 mes" : `en ${months} meses`;
}

// Compute relationship stats from past + future sessions. Returns
// { firstSessionDate, completedCount, monthsLabel } for the
// "Camino contigo" tile. Uses the OLDEST session's date as the
// "started together" anchor — works regardless of whether the
// first session is past, completed, or future-but-already-booked.
export function computeJourneyStats(allSessions, patientId) {
  if (!patientId) return null;
  const own = (allSessions || []).filter(s => s.patient_id === patientId);
  if (own.length === 0) return null;
  const isos = own
    .map(s => shortDateToISO(s.date))
    .filter(Boolean)
    .sort();
  if (isos.length === 0) return null;
  const firstIso = isos[0];
  const firstDate = new Date(firstIso + "T12:00:00");
  if (Number.isNaN(firstDate.getTime())) return null;
  const completedCount = own.filter(s => {
    if (s.status === "completed" || s.status === "charged") return true;
    if (s.status === "scheduled") {
      const iso = shortDateToISO(s.date);
      if (!iso) return false;
      const [h = "0", m = "0"] = (s.time || "00:00").split(":");
      const ts = new Date(`${iso}T${h.padStart(2,"0")}:${m.padStart(2,"0")}:00`).getTime() + 3_600_000;
      return ts <= Date.now();
    }
    return false;
  }).length;
  const now = new Date();
  const months = (now.getFullYear() - firstDate.getFullYear()) * 12
    + (now.getMonth() - firstDate.getMonth())
    + (now.getDate() >= firstDate.getDate() ? 0 : -1);
  const days = Math.max(0, Math.floor((now - firstDate) / 86_400_000));
  let durationLabel;
  if (days < 7) durationLabel = days <= 1 ? "esta semana" : `hace ${days} días`;
  else if (days < 30) {
    const weeks = Math.floor(days / 7);
    durationLabel = weeks === 1 ? "hace una semana" : `hace ${weeks} semanas`;
  } else if (months < 12) {
    durationLabel = months <= 1 ? "hace un mes" : `hace ${months} meses`;
  } else {
    const years = Math.floor(months / 12);
    durationLabel = years === 1 ? "hace un año" : `hace ${years} años`;
  }
  const startLabel = `${firstDate.getDate()} de ${MONTH_NAMES[firstDate.getMonth()]} de ${firstDate.getFullYear()}`;
  return { firstSessionDate: startLabel, durationLabel, completedCount };
}
