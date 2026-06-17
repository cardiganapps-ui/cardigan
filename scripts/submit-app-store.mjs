#!/usr/bin/env node
/* ── App Store submission via the App Store Connect API ───────────────
   Promotes an already-uploaded TestFlight build to a public App Store
   release: finds the processed build for the target marketing version,
   creates (or reuses) the matching appStoreVersion, attaches the build,
   sets the Spanish "Novedades" (what's-new) text, and submits for review.

   Pure API — no Mac, no fastlane. Runs in CI (app-store-submit.yml) using
   the same App Store Connect API key the TestFlight upload uses.

   Env:
     ASC_KEY_ID        — 10-char App Store Connect API key id
     ASC_ISSUER        — issuer UUID
     ASC_KEY_BASE64    — base64 of the .p8 private key (PEM)
     TARGET_VERSION    — marketing version to release (e.g. "20.3")
     BUNDLE_ID         — app bundle id (default mx.cardigan.app)
     WHATS_NEW         — release notes (es) shown on the App Store
     SUBMIT            — "false" to prepare everything but stop before the
                         final submit-for-review (default: submit)
     RELEASE_TYPE      — AFTER_APPROVAL (default) | MANUAL | SCHEDULED
     POLL_TIMEOUT_MIN  — minutes to wait for the build to finish Apple's
                         processing before giving up (default 45)

   Exit codes: 0 success, non-zero on any failure (loud, never silent). */

import crypto from "node:crypto";

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER = process.env.ASC_ISSUER;
const KEY_B64 = process.env.ASC_KEY_BASE64;
const TARGET = (process.env.TARGET_VERSION || "").trim();
const BUNDLE_ID = (process.env.BUNDLE_ID || "mx.cardigan.app").trim();
const WHATS_NEW = (process.env.WHATS_NEW || "").trim();
const SUBMIT = process.env.SUBMIT !== "false";
const RELEASE_TYPE = (process.env.RELEASE_TYPE || "AFTER_APPROVAL").trim();
const POLL_TIMEOUT_MIN = Number(process.env.POLL_TIMEOUT_MIN || "45");

const BASE = "https://api.appstoreconnect.apple.com";

function die(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

if (!KEY_ID || !ISSUER || !KEY_B64) die("Missing ASC_KEY_ID / ASC_ISSUER / ASC_KEY_BASE64");
if (!TARGET) die("Missing TARGET_VERSION");

// ── ASC JWT (ES256, 20-min lifetime, reused across calls) ──
let _jwt = null, _jwtAt = 0;
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  if (_jwt && now - _jwtAt < 1000) return _jwt;
  const pem = Buffer.from(KEY_B64, "base64").toString("utf8");
  if (!pem.includes("BEGIN PRIVATE KEY")) die("ASC_KEY_BASE64 did not decode to a PEM private key");
  const b64url = (b) => Buffer.from(b).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
  const input = `${header}.${payload}`;
  const sig = crypto.sign("SHA256", Buffer.from(input), { key: pem, dsaEncoding: "ieee-p1363" }).toString("base64url");
  _jwt = `${input}.${sig}`; _jwtAt = now;
  return _jwt;
}

async function api(method, path, body) {
  const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.status} ${e.code}: ${e.title} — ${e.detail}`).join(" | ") || text;
    throw new Error(`${method} ${path} → ${res.status}\n   ${detail}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. App id from bundle id ──
async function getAppId() {
  const r = await api("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
  const app = r?.data?.[0];
  if (!app) die(`No app found for bundleId ${BUNDLE_ID}`);
  console.log(`• App: ${app.attributes?.name} (${app.id})`);
  return app.id;
}

// ── 2. Find the processed build for TARGET marketing version ──
async function findValidBuild(appId) {
  const deadline = Date.now() + POLL_TIMEOUT_MIN * 60_000;
  let waited = false;
  for (;;) {
    // Builds for this app, newest first, with their marketing version.
    const r = await api(
      "GET",
      `/v1/builds?filter[app]=${appId}&include=preReleaseVersion&sort=-version&limit=50`
    );
    const preVer = new Map(
      (r.included || [])
        .filter((i) => i.type === "preReleaseVersions")
        .map((i) => [i.id, i.attributes?.version])
    );
    const candidates = (r.data || [])
      .map((b) => ({
        id: b.id,
        buildNumber: b.attributes?.version,
        state: b.attributes?.processingState,
        expired: b.attributes?.expired,
        marketing: preVer.get(b.relationships?.preReleaseVersion?.data?.id),
      }))
      .filter((b) => b.marketing === TARGET && !b.expired);

    const valid = candidates.find((b) => b.state === "VALID");
    if (valid) {
      console.log(`• Build: ${TARGET} (${valid.buildNumber}) — ${valid.state} [${valid.id}]`);
      return valid.id;
    }
    const processing = candidates.find((b) => b.state === "PROCESSING");
    if (Date.now() > deadline) {
      if (candidates.length === 0) {
        die(`No build with marketing version ${TARGET} found after ${POLL_TIMEOUT_MIN} min. ` +
            `Did build #102 upload to TestFlight (Apple daily upload cap)?`);
      }
      die(`Build ${TARGET} still not VALID after ${POLL_TIMEOUT_MIN} min ` +
          `(states: ${candidates.map((c) => `${c.buildNumber}:${c.state}`).join(", ")})`);
    }
    if (!waited) {
      console.log(`• Waiting for build ${TARGET} to finish processing` +
        (processing ? ` (build ${processing.buildNumber} is PROCESSING)` : " (not visible yet)") +
        `, up to ${POLL_TIMEOUT_MIN} min…`);
      waited = true;
    }
    await sleep(60_000);
  }
}

// ── 3. Find or create the appStoreVersion for TARGET ──
async function getOrCreateVersion(appId) {
  const existing = await api(
    "GET",
    `/v1/apps/${appId}/appStoreVersions?filter[versionString]=${TARGET}&filter[platform]=IOS&limit=1`
  );
  const v = existing?.data?.[0];
  if (v) {
    console.log(`• App Store version ${TARGET} already exists — state ${v.attributes?.appStoreState} [${v.id}]`);
    const editable = ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"];
    if (!editable.includes(v.attributes?.appStoreState)) {
      die(`Version ${TARGET} is in state ${v.attributes?.appStoreState}, which isn't editable. ` +
          `Resolve it in App Store Connect first.`);
    }
    return v.id;
  }
  const created = await api("POST", "/v1/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: { platform: "IOS", versionString: TARGET, releaseType: RELEASE_TYPE },
      relationships: { app: { data: { type: "apps", id: appId } } },
    },
  });
  console.log(`• Created App Store version ${TARGET} (releaseType=${RELEASE_TYPE}) [${created.data.id}]`);
  return created.data.id;
}

// ── 4. Attach the build to the version ──
async function attachBuild(versionId, buildId) {
  await api("PATCH", `/v1/appStoreVersions/${versionId}/relationships/build`, {
    data: { type: "builds", id: buildId },
  });
  console.log("• Build attached to version");
}

// ── 5. Set the "what's new" text on every existing localization ──
async function setWhatsNew(versionId) {
  if (!WHATS_NEW) { console.log("• No WHATS_NEW provided — leaving release notes unchanged"); return; }
  const locs = await api("GET", `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=50`);
  if (!locs?.data?.length) { console.log("• No localizations on this version yet — skipping what's-new"); return; }
  for (const loc of locs.data) {
    await api("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, {
      data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: { whatsNew: WHATS_NEW } },
    });
    console.log(`• Set release notes for locale ${loc.attributes?.locale}`);
  }
}

// ── 6. Submit for review (reviewSubmissions API) ──
async function submitForReview(appId, versionId) {
  // Reuse an open submission if one exists, else create.
  let subId;
  const open = await api(
    "GET",
    `/v1/reviewSubmissions?filter[app]=${appId}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES&limit=1`
  );
  if (open?.data?.[0]) {
    subId = open.data[0].id;
    console.log(`• Reusing open review submission [${subId}] (state ${open.data[0].attributes?.state})`);
  } else {
    const created = await api("POST", "/v1/reviewSubmissions", {
      data: {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    subId = created.data.id;
    console.log(`• Created review submission [${subId}]`);
  }

  // Add the version as an item (idempotent-ish: ignore "already added").
  try {
    await api("POST", "/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: subId } },
          appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
        },
      },
    });
    console.log("• Added version to the review submission");
  } catch (e) {
    if (/already|exists|duplicate/i.test(e.message)) console.log("• Version already in the submission — continuing");
    else throw e;
  }

  if (!SUBMIT) {
    console.log("\n⏸  SUBMIT=false — everything is staged but NOT submitted. " +
      "Review in App Store Connect and submit when ready.");
    return;
  }

  await api("PATCH", `/v1/reviewSubmissions/${subId}`, {
    data: { type: "reviewSubmissions", id: subId, attributes: { submitted: true } },
  });
  console.log("\n✓ Submitted for App Store review.");
}

(async () => {
  console.log(`\n=== App Store submission · version ${TARGET} · ${BUNDLE_ID} ===`);
  const appId = await getAppId();
  const buildId = await findValidBuild(appId);
  const versionId = await getOrCreateVersion(appId);
  await attachBuild(versionId, buildId);
  await setWhatsNew(versionId);
  await submitForReview(appId, versionId);
  console.log("\nDone.");
})().catch((e) => die(e.message));
