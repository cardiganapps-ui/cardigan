// Generate a premium 2732×2732 splash.png for iOS LaunchScreen +
// Capacitor SplashScreen plugin. Source-of-truth: solid Cardigan
// teal (matching capacitor.config.json's backgroundColor) with the
// white link mark centered at ~22% of canvas width.
//
// Previous splash.png shipped a small dark-teal square plate
// floating on lighter teal — the plate read as a UI element, not
// a brand surface. This rebuild kills the plate and matches the
// "edge-to-edge brand color + centered mark" pattern used by
// Headspace, Spotify, Apple News.
//
// Run: node scripts/generate-splash.mjs
//
// Idempotent — writes assets/splash.png each run. The CI workflow
// then ingests via @capacitor/assets to produce iOS variants.

import sharp from "sharp";
import { writeFileSync } from "fs";

const CANVAS = 2732;
const BG = "#5B9BAF"; // --teal, matches capacitor.config.json
const MARK_WIDTH_RATIO = 0.22; // mark = 22% of canvas → ~600px → premium-sized

// The Cardigan link-mark path, copied verbatim from public/favicon.svg.
// Source viewBox is 330 240 370 280 (natural mark canvas).
const MARK_PATH = "M465.486908,353.571228 C474.090210,336.407806 482.106873,319.350922 491.049652,302.794220 C507.495972,272.345459 533.544800,256.787231 567.993652,255.748184 C599.452759,254.799316 625.348145,266.962311 644.410645,291.838776 C680.562561,339.016815 657.004272,409.877563 600.107971,427.019165 C588.789185,430.429291 577.294495,431.815765 565.639832,432.090698 C551.631104,432.421143 541.504761,437.837585 534.487610,450.592590 C520.503235,476.011749 498.809967,491.664398 470.558411,498.628937 C426.776581,509.422028 378.399597,487.563873 359.407501,446.857910 C338.089233,401.166321 357.395447,347.117218 407.480682,325.787262 C425.934418,317.928314 445.234436,317.533417 464.516876,317.984039 C464.901245,318.817078 465.234009,319.205627 465.144745,319.392456 C460.128296,329.888000 455.130615,340.393311 449.992065,350.829224 C448.645355,353.564301 445.784424,353.049988 443.325989,353.217987 C427.544678,354.296600 413.335907,359.111908 401.960358,370.648560 C382.453339,390.431671 380.663818,420.755676 397.709930,442.677643 C420.052704,471.411346 461.031647,475.683807 488.679413,451.990387 C494.767212,446.773315 499.888123,440.578857 503.628876,433.390350 C516.228882,409.177155 536.942078,398.494415 563.450317,397.793243 C573.520630,397.526855 583.406982,396.570374 592.815247,392.808777 C617.522583,382.930389 628.672119,357.778625 626.331421,337.888367 C622.858276,308.375580 595.711487,290.757385 574.521301,290.039307 C549.799683,289.201508 531.911194,298.969116 520.917480,321.527832 C508.438812,347.133484 495.429779,372.480957 482.609070,397.919342 C478.609131,405.855865 472.895386,411.532715 463.257568,411.202484 C450.846710,410.777252 442.988129,397.964691 448.448853,386.801544 C453.863129,375.733368 459.678528,364.861420 465.486908,353.571228z";

// Mark natural width (path's bounding-box width within its viewBox).
// Used to scale into the splash canvas at the target ratio.
const MARK_NATURAL_W = 370;
const MARK_NATURAL_H = 280;

// Render mark to CANVAS * MARK_WIDTH_RATIO width, then center.
const markW = Math.round(CANVAS * MARK_WIDTH_RATIO);
const markH = Math.round(markW * (MARK_NATURAL_H / MARK_NATURAL_W));
const markX = Math.round((CANVAS - markW) / 2);
const markY = Math.round((CANVAS - markH) / 2);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <rect width="${CANVAS}" height="${CANVAS}" fill="${BG}"/>
  <svg x="${markX}" y="${markY}" width="${markW}" height="${markH}" viewBox="330 240 ${MARK_NATURAL_W} ${MARK_NATURAL_H}">
    <path fill="#FFFFFF" d="${MARK_PATH}"/>
  </svg>
</svg>`;

const out = "assets/splash.png";
await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`✓ wrote ${out} — ${CANVAS}×${CANVAS}, solid ${BG}, mark ${markW}px (${(MARK_WIDTH_RATIO * 100).toFixed(0)}% of canvas)`);
