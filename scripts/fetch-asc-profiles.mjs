#!/usr/bin/env node
/* ── Fetch provisioning profiles from the App Store Connect API ──────
   Used by .github/workflows/ios-build.yml instead of BUILD_*_PROFILE
   secrets: the workflow already holds an ASC API key for the TestFlight
   upload, and profiles fetched at build time are always the CURRENT
   ones — no more re-encoding a secret every time a capability change
   invalidates a profile (the App Groups rollout is exactly that case).

   Env:
     ASC_KEY_PATH   — path to the AuthKey_<id>.p8 (already decoded by
                      the workflow for altool)
     ASC_KEY_ID     — 10-char key id
     ASC_ISSUER     — issuer UUID
     PROFILES_DIR   — where to install (CI: ~/Library/MobileDevice/
                      Provisioning Profiles; tests: any tmp dir)
     PROFILE_NAMES  — comma-separated exact profile names to fetch

   Installs each profile under <UUID>.mobileprovision (the UUID is read
   from the profile payload itself, matching what Xcode expects) and
   fails loudly if a requested name is missing or not ACTIVE.

   Zero npm deps — ES256 JWT via node:crypto (ieee-p1363 signature
   encoding is the JOSE raw r||s format). */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const {
  ASC_KEY_PATH,
  ASC_KEY_ID,
  ASC_ISSUER,
  PROFILES_DIR,
  PROFILE_NAMES,
} = process.env;

for (const [name, value] of Object.entries({ ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER, PROFILES_DIR, PROFILE_NAMES })) {
  if (!value) {
    console.error(`fetch-asc-profiles: missing env ${name}`);
    process.exit(1);
  }
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function ascJWT() {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    iss: ASC_ISSUER,
    iat: now,
    exp: now + 15 * 60,
    aud: "appstoreconnect-v1",
  }));
  const signingInput = `${header}.${payload}`;
  const key = crypto.createPrivateKey(fs.readFileSync(ASC_KEY_PATH, "utf8"));
  const signature = crypto.sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

// The profile's UUID lives inside its CMS payload — extract it without
// macOS `security cms` by scanning the embedded plist text.
function profileUUID(der) {
  const text = der.toString("latin1");
  const m = text.match(/<key>UUID<\/key>\s*<string>([0-9a-fA-F-]{36})<\/string>/);
  if (!m) throw new Error("UUID not found in profile payload");
  return m[1];
}

const wanted = PROFILE_NAMES.split(",").map((s) => s.trim()).filter(Boolean);
const token = ascJWT();
const url = new URL("https://api.appstoreconnect.apple.com/v1/profiles");
url.searchParams.set("filter[name]", wanted.join(","));
url.searchParams.set("limit", "20");

const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) {
  console.error(`fetch-asc-profiles: ASC API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}
const { data } = await res.json();

fs.mkdirSync(PROFILES_DIR, { recursive: true });
const found = new Map();
for (const profile of data || []) {
  const { name, profileState, profileContent } = profile.attributes;
  if (!wanted.includes(name) || found.has(name)) continue;
  if (profileState !== "ACTIVE") {
    console.error(`fetch-asc-profiles: profile "${name}" is ${profileState}, not ACTIVE — regenerate it`);
    process.exit(1);
  }
  const der = Buffer.from(profileContent, "base64");
  const uuid = profileUUID(der);
  const dest = path.join(PROFILES_DIR, `${uuid}.mobileprovision`);
  fs.writeFileSync(dest, der);
  console.log(`✓ installed "${name}" → ${dest}`);
  found.set(name, uuid);
}

const missing = wanted.filter((name) => !found.has(name));
if (missing.length) {
  console.error(`fetch-asc-profiles: profile(s) not found in ASC: ${missing.join(", ")}`);
  process.exit(1);
}
