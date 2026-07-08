/* ── Play Store screenshot generator ─────────────────────────────────
   Regenerates the annotated phone screenshots in
   docs/play-store-assets/screenshots/ from the real app running in demo
   mode. Two stages:

     1. RAW captures — Playwright (chromium) drives a `vite preview` of
        the --mode e2e build at 412×800 @ dsf 3 (1236×2400), enters demo
        via /?testMode=1 → "Probar demo", hides the demo banner.
     2. COMPOSE — each raw capture is placed in an HTML compositor
        (brand-teal gradient, Nunito caption block, rounded device
        frame) rendered at exactly 1080×2160 (2:1 — Play's phone cap).

   Usage:
     node scripts/play-store-screenshots.mjs              # build + all frames
     node scripts/play-store-screenshots.mjs --skip-build # reuse dist/
     node scripts/play-store-screenshots.mjs --raw-only   # skip composition
     node scripts/play-store-screenshots.mjs --frame 02-agenda

   One-time-per-release assets: run manually, review, commit. Not CI. */

import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/play-store-assets/screenshots");
const RAW_DIR = join(ROOT, "docs/play-store-assets/screenshots/.raw");
const PORT = 5181;

const args = process.argv.slice(2);
const SKIP_BUILD = args.includes("--skip-build");
const RAW_ONLY = args.includes("--raw-only");
const ONLY_FRAME = args.includes("--frame") ? args[args.indexOf("--frame") + 1] : null;

/* Frame definitions. `capture` runs with the page already inside demo
   mode on #home. Captions are es-419 store-listing copy. */
const FRAMES = [
  {
    id: "01-inicio",
    headline: "Tu consulta, en orden",
    sub: "Agenda, pacientes y finanzas en un solo lugar",
    capture: async (page) => {
      await page.evaluate(() => { location.hash = "#home"; });
      await page.waitForSelector(".kpi-card", { timeout: 10_000 });
    },
  },
  {
    id: "02-agenda",
    headline: "Agenda que se cuida sola",
    sub: "Las sesiones recurrentes se extienden automáticamente",
    capture: async (page) => {
      await page.evaluate(() => { location.hash = "#agenda"; });
      await page.waitForSelector(".session-row, .cal-strip", { timeout: 10_000 });
    },
  },
  {
    id: "03-pacientes",
    headline: "Cada paciente, a un toque",
    sub: "Expediente con notas, pagos y archivos",
    capture: async (page) => {
      await page.evaluate(() => { location.hash = "#patients"; });
      await page.waitForSelector(".row-item", { timeout: 10_000 });
    },
  },
  {
    id: "04-finanzas",
    headline: "Finanzas sin hojas de cálculo",
    sub: "Saldos, pagos y proyección al instante",
    capture: async (page) => {
      await page.evaluate(() => { location.hash = "#finances"; });
      await page.waitForSelector(".bal-row, .kpi-card", { timeout: 10_000 });
    },
  },
  {
    id: "05-notas",
    headline: "Tus notas, siempre a la mano",
    sub: "Privadas, con cifrado opcional",
    capture: async (page) => {
      await page.evaluate(() => { location.hash = "#notes"; });
      await page.waitForSelector(".note-card, .card", { timeout: 10_000 });
    },
  },
  {
    id: "06-gastos",
    headline: "Gastos con foto del recibo",
    sub: "Registra un gasto en segundos",
    capture: async (page) => {
      await page.evaluate(() => { location.hash = "#finances"; });
      await page.waitForSelector(".bal-row, .kpi-card", { timeout: 10_000 });
      // Gastos is the third tab of Finanzas.
      const tab = page.getByRole("tab", { name: /gastos/i }).or(page.getByText("Gastos", { exact: true }).first());
      await tab.first().click();
      await page.waitForTimeout(800);
    },
  },
];

function compositorHTML(rawDataURI, headline, sub, fontDataURI) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: "Nunito"; src: url("${fontDataURI}") format("woff2"); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1080px; height: 2160px; overflow: hidden;
         background: linear-gradient(160deg, #1F7A8C 0%, #16606F 55%, #10505D 100%);
         font-family: "Nunito", system-ui, sans-serif; }
  .caption { padding: 96px 84px 48px; text-align: center; }
  .headline { color: #fff; font-size: 76px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.12; }
  .sub { color: rgba(255,255,255,0.82); font-size: 40px; font-weight: 400; margin-top: 22px; line-height: 1.3; }
  .shot { display: flex; justify-content: center; }
  .frame { width: 866px; border-radius: 56px; overflow: hidden;
           border: 10px solid rgba(255,255,255,0.16);
           box-shadow: 0 48px 120px rgba(0,0,0,0.42); }
  .frame img { display: block; width: 100%; }
  </style></head><body>
    <div class="caption"><div class="headline">${headline}</div><div class="sub">${sub}</div></div>
    <div class="shot"><div class="frame"><img src="${rawDataURI}"></div></div>
  </body></html>`;
}

async function main() {
  if (!SKIP_BUILD) {
    console.log("Building --mode e2e…");
    execSync("npm run build:e2e", { cwd: ROOT, stdio: "inherit" });
  }

  console.log("Starting preview server…");
  const server = spawn("npx", ["vite", "preview", "--mode", "e2e", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));

  mkdirSync(RAW_DIR, { recursive: true });
  const frames = ONLY_FRAME ? FRAMES.filter((f) => f.id === ONLY_FRAME) : FRAMES;
  if (!frames.length) throw new Error(`Unknown frame ${ONLY_FRAME}`);

  const browser = await chromium.launch();
  try {
    /* Stage 1 — raw captures in demo mode. */
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 800 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: "es-MX",
    });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/?testMode=1`);
    await page.getByRole("button", { name: "Probar demo" }).first().click();
    await page.waitForSelector(".kpi-card", { timeout: 15_000 });
    // Clean frames: no demo banner (documented trick in the assets README).
    await page.addStyleTag({ content: ".app-banner--demo{display:none!important}" });

    for (const frame of frames) {
      await frame.capture(page);
      await page.waitForTimeout(600); // let entry animations settle
      await page.addStyleTag({ content: ".app-banner--demo{display:none!important}" });
      await page.screenshot({ path: join(RAW_DIR, `${frame.id}.png`) });
      console.log(`raw   ${frame.id}.png`);
    }
    await ctx.close();

    if (!RAW_ONLY) {
      /* Stage 2 — compose annotated 1080×2160 frames. */
      const fontDataURI = `data:font/woff2;base64,${readFileSync(join(ROOT, "public/fonts/nunito-400-latin.woff2")).toString("base64")}`;
      const ctx2 = await browser.newContext({ viewport: { width: 1080, height: 2160 }, deviceScaleFactor: 1 });
      const page2 = await ctx2.newPage();
      for (const frame of frames) {
        const raw = readFileSync(join(RAW_DIR, `${frame.id}.png`));
        const rawURI = `data:image/png;base64,${raw.toString("base64")}`;
        await page2.setContent(compositorHTML(rawURI, frame.headline, frame.sub, fontDataURI), { waitUntil: "networkidle" });
        await page2.screenshot({ path: join(OUT_DIR, `${frame.id}.png`) });
        console.log(`final ${frame.id}.png (1080×2160)`);
      }
      await ctx2.close();
      rmSync(RAW_DIR, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
