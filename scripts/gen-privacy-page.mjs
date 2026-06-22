/* Generates a public, static privacy-policy page at public/privacidad/index.html
   from the single source of truth (src/data/privacy.js). App Store review
   requires a privacy-policy URL reachable WITHOUT logging in; the SPA's
   in-app policy lives behind auth, so this static page is the public face.

   Run: node scripts/gen-privacy-page.mjs   (also wired into prebuild so it
   never goes stale vs privacy.js). */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// privacy.js is plain data (no imports), but it's authored as a browser ESM
// module; import it dynamically so we get POLICY_SECTIONS etc. directly.
const { POLICY_SECTIONS, POLICY_VERSION, POLICY_PUBLISHED } =
  await import(resolve(ROOT, "src/data/privacy.ts"));

// The policy uses profession-vocabulary placeholders ({client.p}/{client.s})
// that the app resolves per-profession at runtime. The public page is
// profession-agnostic, so substitute generic Spanish terms.
function resolveVocab(s) {
  return s
    .replace(/\{client\.p\}/g, "pacientes, clientes o alumnos")
    .replace(/\{client\.s\}/g, "paciente, cliente o alumno");
}
function esc(s) {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const sectionsHtml = POLICY_SECTIONS.map((s) => {
  const paras = resolveVocab(s.body)
    .split("\n\n")
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<section>\n  <h2>${esc(resolveVocab(s.title))}</h2>\n  ${paras}\n</section>`;
}).join("\n\n");

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Aviso de privacidad — Cardigan</title>
<meta name="robots" content="index,follow">
<meta name="description" content="Aviso de privacidad de Cardigan, conforme a la LFPDPPP.">
<link rel="canonical" href="https://cardigan.mx/privacidad/">
<style>
  :root { --teal:#5B9BAF; --charcoal:#2E2E2E; --charcoal-md:#555; --charcoal-xl:#8a8a8a; --border:#E3DBD1; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: var(--charcoal);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%; line-height: 1.6; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 20px; letter-spacing: -0.3px; color: var(--charcoal); margin-bottom: 28px; }
  .brand .dot { width: 18px; height: 18px; border-radius: 50%; background: var(--teal); display: inline-block; }
  h1 { font-size: 28px; font-weight: 900; letter-spacing: -0.02em; margin: 0 0 4px; }
  .meta { color: var(--charcoal-xl); font-size: 14px; margin-bottom: 32px; }
  section { margin-bottom: 28px; }
  h2 { font-size: 17px; font-weight: 800; margin: 0 0 8px; }
  p { font-size: 15px; color: var(--charcoal-md); margin: 0 0 10px; }
  a { color: var(--teal); }
  .foot { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); font-size: 13px; color: var(--charcoal-xl); }
  @media (prefers-color-scheme: dark) {
    html, body { background: #1A1A1A; color: #ededed; }
    h1, h2, .brand { color: #fff; }
    p { color: #c7c7c7; }
    .meta, .foot { color: #9a9a9a; }
    .foot { border-top-color: rgba(255,255,255,0.12); }
  }
</style>
</head>
<body>
  <main class="wrap">
    <div class="brand"><span class="dot"></span> cardigan</div>
    <h1>Aviso de privacidad</h1>
    <div class="meta">Versión ${esc(POLICY_VERSION)} · Publicado el ${esc(POLICY_PUBLISHED)}</div>
${sectionsHtml}
    <div class="foot">
      Para solicitudes relacionadas con este aviso o el ejercicio de tus derechos ARCO,
      contáctanos en <a href="mailto:privacy@cardigan.mx">privacy@cardigan.mx</a>.
    </div>
  </main>
</body>
</html>
`;

const outDir = resolve(ROOT, "public/privacidad");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "index.html"), html, "utf8");
console.log(`Wrote public/privacidad/index.html (${POLICY_SECTIONS.length} sections, v${POLICY_VERSION})`);
