/* Pure i18n template resolver.

   Lifted out of I18nProvider's t() callback so it can be unit-tested
   without mounting React. The provider holds the active vocab + key
   lookup; this module owns the placeholder grammar.

   Placeholder grammar (resolved against the active profession's vocab
   in src/i18n/vocabulary.js):

     {plural}        — legacy English-style "+s" pluraliser. Driven by
                        vars.count. DON'T use with vocab nouns: Spanish
                        plurals aren't always "+s" (sesión → sesiones).
     {name}          — variable substitution from vars (used for proper
                        nouns, counts, dates, etc.).
     {noun.form}     — vocab lookup. form ∈ s | p | art | artP | del |
                        al | de | a (the contractions are derived in
                        vocabulary.js).
     {noun.S} / .P   — capitalised first letter of the singular / plural.
                        Use at sentence start or in titles.
     {noun}          — count-aware shortcut: returns vocab[k].p when
                        vars.count !== 1, vocab[k].s otherwise. Pairs
                        with `{count} {client}` for grammatical "1
                        paciente" / "3 pacientes" without the fragile
                        {plural} suffix. */

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function resolveTemplate(template, vars, vocab) {
  if (typeof template !== "string") return template;
  return template.replace(/\{(\w+)(?:\.(\w+))?\}/g, (_, k, sub) => {
    if (k === "plural") {
      const count = vars?.count ?? 0;
      return count !== 1 ? "s" : "";
    }
    if (vocab && vocab[k]) {
      if (!sub) {
        const isSingular = vars?.count === 1;
        return isSingular ? vocab[k].s : vocab[k].p;
      }
      if (sub === "S") return cap(vocab[k].s);
      if (sub === "P") return cap(vocab[k].p);
      return vocab[k][sub] ?? "";
    }
    if (!vars) return "";
    return vars[k] ?? "";
  });
}

/* Walks a dot-path (e.g. "patients.selectHint") through a strings object
   and returns the leaf value. Returns the original key if any segment
   misses, so consumers see the missing key rather than a blank. */
export function lookupKey(strings, key) {
  const parts = key.split(".");
  let val = strings;
  for (const p of parts) {
    if (val == null) return key;
    val = val[p];
  }
  return val == null ? key : val;
}
