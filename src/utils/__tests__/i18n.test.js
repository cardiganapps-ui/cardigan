import { describe, it, expect } from "vitest";
import { resolveTemplate, lookupKey } from "../../i18n/resolve.js";
import { VOCAB, getVocab } from "../../i18n/vocabulary.js";
import { PROFESSIONS } from "../../data/constants.js";

const PSYCH = VOCAB.psychologist;
const NUTRI = VOCAB.nutritionist;
const TUTOR = VOCAB.tutor;
const TRAINER = VOCAB.trainer;

describe("resolveTemplate — vars only", () => {
  it("substitutes {name}-style placeholders", () => {
    expect(resolveTemplate("Hola {name}", { name: "Diego" }, PSYCH)).toBe("Hola Diego");
  });

  it("returns empty string for unknown placeholders when vars is missing", () => {
    expect(resolveTemplate("Hola {name}", undefined, PSYCH)).toBe("Hola ");
  });

  it("falls back to empty string when a vars key isn't provided", () => {
    expect(resolveTemplate("Hola {name}", { other: "x" }, PSYCH)).toBe("Hola ");
  });

  it("passes the template through when there are no placeholders", () => {
    expect(resolveTemplate("Hola mundo", undefined, PSYCH)).toBe("Hola mundo");
  });

  it("returns non-string templates unchanged", () => {
    const arr = ["a", "b"];
    expect(resolveTemplate(arr, undefined, PSYCH)).toBe(arr);
  });
});

describe("resolveTemplate — legacy {plural} macro", () => {
  it("appends 's' when count !== 1", () => {
    expect(resolveTemplate("nota{plural}", { count: 3 }, PSYCH)).toBe("notas");
  });

  it("appends nothing when count === 1", () => {
    expect(resolveTemplate("nota{plural}", { count: 1 }, PSYCH)).toBe("nota");
  });

  it("treats missing count as 0 (plural)", () => {
    expect(resolveTemplate("nota{plural}", {}, PSYCH)).toBe("notas");
  });
});

describe("resolveTemplate — vocab forms", () => {
  it("{noun.s} returns the singular for the active profession", () => {
    expect(resolveTemplate("{client.s}", undefined, PSYCH)).toBe("paciente");
    expect(resolveTemplate("{client.s}", undefined, TUTOR)).toBe("alumno");
    expect(resolveTemplate("{client.s}", undefined, TRAINER)).toBe("cliente");
  });

  it("{noun.p} returns the plural for the active profession", () => {
    expect(resolveTemplate("{session.p}", undefined, PSYCH)).toBe("sesiones");
    expect(resolveTemplate("{session.p}", undefined, NUTRI)).toBe("consultas");
    expect(resolveTemplate("{session.p}", undefined, TUTOR)).toBe("clases");
  });

  it("{noun.S} capitalises the first letter of the singular", () => {
    expect(resolveTemplate("{session.S}", undefined, PSYCH)).toBe("Sesión");
    expect(resolveTemplate("{session.S}", undefined, NUTRI)).toBe("Consulta");
  });

  it("{noun.P} capitalises the first letter of the plural", () => {
    expect(resolveTemplate("{client.P}", undefined, PSYCH)).toBe("Pacientes");
    expect(resolveTemplate("{client.P}", undefined, TUTOR)).toBe("Alumnos");
  });

  it("{noun.art} / {noun.artP} return Spanish articles", () => {
    expect(resolveTemplate("{client.art}", undefined, PSYCH)).toBe("el");
    expect(resolveTemplate("{client.artP}", undefined, PSYCH)).toBe("los");
    expect(resolveTemplate("{session.art}", undefined, PSYCH)).toBe("la");
  });

  it("returns empty string for an unknown sub-form on a known noun", () => {
    expect(resolveTemplate("{client.zzz}", undefined, PSYCH)).toBe("");
  });
});

describe("resolveTemplate — count-aware {noun} shortcut", () => {
  it("returns plural when count !== 1", () => {
    expect(resolveTemplate("{count} {client}", { count: 3 }, PSYCH)).toBe("3 pacientes");
    expect(resolveTemplate("{count} {client}", { count: 0 }, PSYCH)).toBe("0 pacientes");
  });

  it("returns singular when count === 1", () => {
    expect(resolveTemplate("{count} {client}", { count: 1 }, PSYCH)).toBe("1 paciente");
  });

  it("defaults to plural when count is missing", () => {
    expect(resolveTemplate("{client}", undefined, PSYCH)).toBe("pacientes");
  });

  it("respects the active profession's vocab", () => {
    expect(resolveTemplate("{count} {session}", { count: 1 }, NUTRI)).toBe("1 consulta");
    expect(resolveTemplate("{count} {session}", { count: 3 }, NUTRI)).toBe("3 consultas");
    expect(resolveTemplate("{count} {session}", { count: 1 }, TUTOR)).toBe("1 clase");
    expect(resolveTemplate("{count} {session}", { count: 3 }, TUTOR)).toBe("3 clases");
  });
});

describe("resolveTemplate — composed strings (real keys from es.js)", () => {
  it("home.emptyToday — psychologist sees the original copy", () => {
    expect(resolveTemplate("No hay {session.p} hoy.", undefined, PSYCH)).toBe(
      "No hay sesiones hoy."
    );
  });

  it("home.emptyToday — nutritionist sees consulta-flavoured copy", () => {
    expect(resolveTemplate("No hay {session.p} hoy.", undefined, NUTRI)).toBe(
      "No hay consultas hoy."
    );
  });

  it("patients.selectHint — works for every profession we ship", () => {
    const tpl = "Elige un {client.s} de la lista para ver su {record.s}.";
    expect(resolveTemplate(tpl, undefined, PSYCH)).toBe(
      "Elige un paciente de la lista para ver su expediente."
    );
    expect(resolveTemplate(tpl, undefined, NUTRI)).toBe(
      "Elige un paciente de la lista para ver su historial."
    );
    expect(resolveTemplate(tpl, undefined, TUTOR)).toBe(
      "Elige un alumno de la lista para ver su bitácora."
    );
  });

  it("conflict — mixes a vars-supplied {patient} with the {session.s} vocab", () => {
    const tpl = "Ya tienes una {session.s} con {patient} a esa hora.";
    expect(resolveTemplate(tpl, { patient: "Diego" }, PSYCH)).toBe(
      "Ya tienes una sesión con Diego a esa hora."
    );
    expect(resolveTemplate(tpl, { patient: "Diego" }, NUTRI)).toBe(
      "Ya tienes una consulta con Diego a esa hora."
    );
  });
});

describe("vocabulary — every profession has every required form", () => {
  const REQUIRED_NOUNS = ["client", "session", "record", "rate", "minorContact"];
  const REQUIRED_FORMS = ["s", "p", "art", "artP", "del", "al", "delP", "alP"];

  for (const profession of PROFESSIONS) {
    it(`${profession} declares every required noun + form`, () => {
      const v = getVocab(profession);
      for (const noun of REQUIRED_NOUNS) {
        expect(v[noun], `${profession}.${noun}`).toBeDefined();
        for (const form of REQUIRED_FORMS) {
          expect(typeof v[noun][form], `${profession}.${noun}.${form}`).toBe("string");
          expect(v[noun][form].length, `${profession}.${noun}.${form} non-empty`).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe("vocabulary — Spanish article contractions", () => {
  it("contracts de + el → del for masculine singular nouns", () => {
    expect(PSYCH.client.del).toBe("del paciente");
    expect(TUTOR.client.del).toBe("del alumno");
    expect(TRAINER.client.del).toBe("del cliente");
  });

  it("contracts a + el → al for masculine singular nouns", () => {
    expect(PSYCH.client.al).toBe("al paciente");
    expect(TUTOR.client.al).toBe("al alumno");
    expect(TRAINER.client.al).toBe("al cliente");
  });

  it("does NOT contract for feminine singular nouns", () => {
    // session is feminine in psych/nutri/tutor/music ("la sesión / la
    // consulta / la clase"). de + la → "de la", not "del".
    expect(PSYCH.session.del).toBe("de la sesión");
    expect(NUTRI.session.del).toBe("de la consulta");
    expect(TUTOR.session.del).toBe("de la clase");
    expect(PSYCH.session.al).toBe("a la sesión");
  });

  it("contracts session for trainer (masculine 'el entrenamiento')", () => {
    expect(TRAINER.session.del).toBe("del entrenamiento");
    expect(TRAINER.session.al).toBe("al entrenamiento");
  });

  it("never contracts plural articles", () => {
    expect(PSYCH.client.delP).toBe("de los pacientes");
    expect(PSYCH.session.delP).toBe("de las sesiones");
    expect(TUTOR.client.alP).toBe("a los alumnos");
    expect(TUTOR.session.alP).toBe("a las clases");
  });

  it("composes correctly inside a real template", () => {
    const tpl = "Ingresa el nombre {client.del}.";
    expect(resolveTemplate(tpl, undefined, PSYCH)).toBe("Ingresa el nombre del paciente.");
    expect(resolveTemplate(tpl, undefined, TUTOR)).toBe("Ingresa el nombre del alumno.");
    expect(resolveTemplate(tpl, undefined, TRAINER)).toBe("Ingresa el nombre del cliente.");
  });
});

describe("lookupKey", () => {
  const strings = {
    nav: { home: "Inicio", patients: "Pacientes" },
    deeply: { nested: { value: "ok" } },
  };

  it("resolves a top-level key", () => {
    expect(lookupKey(strings, "deeply.nested.value")).toBe("ok");
  });

  it("returns the original key when a segment is missing", () => {
    expect(lookupKey(strings, "nav.missing")).toBe("nav.missing");
  });

  it("returns the original key when an early segment is null", () => {
    expect(lookupKey(strings, "nope.deeper")).toBe("nope.deeper");
  });
});
