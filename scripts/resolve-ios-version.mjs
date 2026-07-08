#!/usr/bin/env node
/* ── Auto-resolve the iOS marketing version from App Store Connect ────
   Prints the CFBundleShortVersionString the build should use, so it
   NEVER has to be bumped by hand.

   Why this exists: Apple closes a marketing-version "train" once a build
   on that version is released to the App Store, and then rejects every
   further upload to it — TestFlight included — with 90062 ("must be
   higher") + 90186 ("train is closed"). Historically someone had to
   remember to bump MARKETING_VERSION in apply-ios-config.sh after each
   release (20.3 → 20.4 → 20.5 → 20.6 all closed this way). This resolver
   removes the manual step.

   Algorithm (see resolveVersion):
     • Bump PAST the highest RELEASED/closed App Store version, so the
       result is always strictly greater than anything Apple has locked.
     • But if an editable App Store version already sits at or above that
       bumped value (a draft the user created for the next release),
       REUSE it instead of skipping a number — so many TestFlight builds
       share one open train and it advances exactly once per release.
     • Floor at FALLBACK_VERSION so a first-run / empty-API case still
       produces a sane baseline.

   Fail-open: ANY error (auth, network, unexpected payload) prints
   FALLBACK_VERSION to stdout and exits 0, so the build proceeds on the
   fallback rather than breaking. The workflow's loud 90062/90186 handler
   + the IOS_MARKETING_VERSION repo-variable override remain the safety
   net for the rare double-failure.

   Env:
     ASC_KEY_PATH       — path to AuthKey_<id>.p8 (decoded by the workflow)
     ASC_KEY_ID         — 10-char key id
     ASC_ISSUER         — issuer UUID
     BUNDLE_ID          — app bundle id (default mx.cardigan.app)
     FALLBACK_VERSION   — baseline / floor (default 20.7)

   Zero npm deps — ES256 JWT via node:crypto, same as fetch-asc-profiles. */

import crypto from "node:crypto";
import fs from "node:fs";

/* App Store version states that mean the train is CLOSED for new build
   submissions (a build on it has been approved/released). Anything NOT in
   this set is treated as an open/editable draft the build can reuse.
   Bias is deliberate: mis-labelling a state as closed only skips a
   version number (harmless); mis-labelling a closed one as open would
   reproduce the 90186 rejection, so post-approval states are all here. */
const CLOSED_STATES = new Set([
  "READY_FOR_SALE",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_APP_STORE",
  "REPLACED_WITH_NEW_VERSION",
  "REMOVED_FROM_SALE",
  "NOT_APPLICABLE",
  "ACCEPTED",
]);

/* Compare two dot-separated numeric versions. Returns <0, 0, >0. */
export function cmpVersion(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/* Increment the last numeric segment: "20.6" → "20.7", "20.6.1" → "20.6.2". */
export function bumpLast(version) {
  const parts = String(version).split(".");
  const last = parts.length - 1;
  parts[last] = String((parseInt(parts[last], 10) || 0) + 1);
  return parts.join(".");
}

/* Pure resolver — unit-tested without touching the network.
   `versions` = [{ versionString, state }] from ASC. */
export function resolveVersion(versions, { fallback = "20.7" } = {}) {
  const valid = (versions || []).filter(
    (v) => v && typeof v.versionString === "string" && /^\d+(\.\d+)*$/.test(v.versionString),
  );

  const closed = valid.filter((v) => CLOSED_STATES.has(v.state));
  const open = valid.filter((v) => !CLOSED_STATES.has(v.state));

  const highestClosed = closed
    .map((v) => v.versionString)
    .sort(cmpVersion)
    .pop();

  // Must be strictly above every released version.
  let target = highestClosed ? bumpLast(highestClosed) : fallback;

  // If an editable draft already sits at/above the bumped value, reuse it
  // rather than skipping a number (keeps the train advancing once/release).
  const highestOpen = open
    .map((v) => v.versionString)
    .sort(cmpVersion)
    .pop();
  if (highestOpen && cmpVersion(highestOpen, target) >= 0) target = highestOpen;

  // Never regress below the known-good baseline.
  if (cmpVersion(target, fallback) < 0) target = fallback;

  return target;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function ascJWT({ keyPath, keyId, issuer }) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const signingInput = `${header}.${payload}`;
  const key = crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8"));
  const signature = crypto.sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

async function ascGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ASC API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  const {
    ASC_KEY_PATH,
    ASC_KEY_ID,
    ASC_ISSUER,
    BUNDLE_ID = "mx.cardigan.app",
    FALLBACK_VERSION = "20.7",
  } = process.env;

  if (!ASC_KEY_PATH || !ASC_KEY_ID || !ASC_ISSUER) {
    throw new Error("missing ASC_KEY_PATH / ASC_KEY_ID / ASC_ISSUER");
  }

  const token = ascJWT({ keyPath: ASC_KEY_PATH, keyId: ASC_KEY_ID, issuer: ASC_ISSUER });

  // App id by bundle id.
  const appsUrl = new URL("https://api.appstoreconnect.apple.com/v1/apps");
  appsUrl.searchParams.set("filter[bundleId]", BUNDLE_ID);
  appsUrl.searchParams.set("limit", "1");
  const apps = await ascGet(appsUrl, token);
  const appId = apps?.data?.[0]?.id;
  if (!appId) throw new Error(`no app found for bundleId ${BUNDLE_ID}`);

  // All App Store versions (versionString + state). 200 is far more than
  // this app's history; the highest is all we need.
  const verUrl = new URL(`https://api.appstoreconnect.apple.com/v1/apps/${appId}/appStoreVersions`);
  verUrl.searchParams.set("limit", "200");
  verUrl.searchParams.set("fields[appStoreVersions]", "versionString,appStoreState");
  const vers = await ascGet(verUrl, token);
  const versions = (vers?.data || []).map((v) => ({
    versionString: v?.attributes?.versionString,
    state: v?.attributes?.appStoreState,
  }));

  console.error(
    `resolve-ios-version: ${versions.length} App Store versions — ` +
      versions.map((v) => `${v.versionString}(${v.state})`).join(", "),
  );

  const target = resolveVersion(versions, { fallback: FALLBACK_VERSION });
  console.error(`resolve-ios-version: → ${target}`);
  process.stdout.write(`${target}\n`);
}

// Only run the network path when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    const fallback = process.env.FALLBACK_VERSION || "20.7";
    console.error(`resolve-ios-version: FAILED (${err?.message || err}); falling back to ${fallback}`);
    process.stdout.write(`${fallback}\n`);
    process.exit(0); // fail-open — never block the build
  });
}
