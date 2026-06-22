#!/usr/bin/env node
/* ── audit-i18n.mjs ──
   Walk src tree (.js and .jsx) for t() calls and diff against the defined
   keys in src/i18n/es.js. Catches the failure mode where a new code
   path calls t("subscription.someNewThing") but the key was never
   added to es.js — the UI renders the raw key text ("subscription.
   someNewThing") and looks broken to anyone who isn't the engineer
   who wrote it. App Store reviewers tend to be that "anyone."

   Exits non-zero on any missing keys so this can be wired into CI.

   Run:    npm run audit:i18n
   Or:     node scripts/audit-i18n.mjs

   Limitations:
   - Static string calls only: t("foo.bar"), t('foo.bar'), t(`foo.bar`).
     Template literals WITH interpolation (t(`pro.${k}.title`)) are
     captured as "dynamic patterns" and skipped from the missing-key
     check — they'd cause false positives. Dynamic call sites are
     listed at the end of the report so you can eyeball whether any
     are likely to hit an undefined key.
   - The `unused keys` list is a heuristic. Anything under a prefix
     that has a dynamic call (e.g. pro.* with pro.${k}.title) gets
     filtered out — we can't statically prove non-use of dynamic
     branches. So the unused count is conservative; some genuinely
     dead keys may still be flagged for cleanup. */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { transform } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      await walk(p, out);
    } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function flatten(obj, prefix = "") {
  const out = new Set();
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const sub of flatten(v, key)) out.add(sub);
    } else {
      out.add(key);
    }
  }
  return out;
}

// Capture t("..."), t('...'), t(`...`) — but NOT t(`foo.${bar}.baz`).
// The negative-lookbehind on $ excludes the interpolation case.
const T_STATIC = /\bt\(\s*["'`]([^"'`$]+)["'`]\s*[,)]/g;
// Capture t(`foo.${bar}.baz`) — the prefix before the first ${
// becomes the "dynamic prefix" we exclude from the unused check.
const T_DYNAMIC = /\bt\(\s*`([^`]*?)\$\{/g;

async function main() {
  // Load es.ts the same way the bundler does, portably across Node
  // versions. esbuild strips any TS syntax in-memory (it's annotation-
  // free today, but this stays correct if types are added later) and we
  // import the result via a data: URL — so this doesn't depend on Node's
  // native type-stripping (which only lands in ≥22.18).
  const { code } = await transform(
    await readFile(join(ROOT, "src/i18n/es.ts"), "utf8"),
    { loader: "ts", format: "esm" }
  );
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  // es.ts exports default or a named `es` — try both.
  const root = mod.default || mod.es;
  if (!root || typeof root !== "object") {
    console.error("Could not load i18n keys from src/i18n/es.ts");
    process.exit(2);
  }
  const defined = flatten(root);

  const files = await walk(join(ROOT, "src"));
  const usedStatic = new Set();
  const dynamicPrefixes = new Set();

  for (const f of files) {
    const src = await readFile(f, "utf-8");
    let m;
    T_STATIC.lastIndex = 0;
    while ((m = T_STATIC.exec(src))) usedStatic.add(m[1]);
    T_DYNAMIC.lastIndex = 0;
    while ((m = T_DYNAMIC.exec(src))) {
      // m[1] is the literal prefix before ${. Strip trailing dot for the
      // namespace match (t(`pro.${k}.title`) → "pro").
      const prefix = m[1].replace(/\.$/, "");
      if (prefix) dynamicPrefixes.add(prefix);
    }
  }

  const missing = [...usedStatic].filter((k) => !defined.has(k)).sort();

  // Unused = defined but not statically used AND not under any
  // dynamic prefix. The dynamic-prefix filter intentionally
  // under-counts to avoid noisy false positives.
  const unused = [...defined]
    .filter((k) => !usedStatic.has(k))
    .filter((k) => ![...dynamicPrefixes].some((p) => k === p || k.startsWith(`${p}.`)))
    .sort();

  console.log(`i18n audit — src/i18n/es.ts vs src tree`);
  console.log("");
  console.log(`  Defined keys:       ${defined.size}`);
  console.log(`  Statically used:    ${usedStatic.size}`);
  console.log(`  Dynamic prefixes:   ${dynamicPrefixes.size}${dynamicPrefixes.size ? " (" + [...dynamicPrefixes].sort().join(", ") + ")" : ""}`);
  console.log(`  Missing keys:       ${missing.length}`);
  console.log(`  Likely unused:      ${unused.length}`);
  console.log("");

  if (missing.length) {
    console.error(`❌ Missing — keys used in source but absent from es.js:`);
    for (const k of missing) console.error(`     ${k}`);
    console.error("");
  }

  if (unused.length) {
    console.warn(`⚠️  Likely unused (verify before deleting — dynamic call sites can hit these):`);
    for (const k of unused) console.warn(`     ${k}`);
    console.warn("");
  }

  if (missing.length) {
    console.error("Failing because of missing keys.");
    process.exit(1);
  }
  console.log("✓ All statically-used keys are defined.");
}

main().catch((err) => {
  console.error("audit-i18n FAILED:", err.message || err);
  process.exit(2);
});
