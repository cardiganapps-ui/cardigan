// Direct APNs (Apple Push Notification service) sender — token-based auth.
//
// iOS delivery goes straight to Apple instead of through FCM: the device
// registers its raw APNs token via @capacitor/push-notifications, we store
// it as a platform='ios' push_subscriptions row, and this helper pushes to
// https://api.push.apple.com using a JWT signed (ES256) with an APNs Auth
// Key (.p8). No Firebase on iOS.
//
// Env (Vercel):
//   APNS_AUTH_KEY_BASE64 — base64 of the .p8 file contents (PEM)
//   APNS_KEY_ID          — 10-char Key ID of that auth key
//   APNS_TEAM_ID         — Apple Team ID (falls back to APPLE_TEAM_ID)
//   APNS_BUNDLE_ID       — app bundle id (default mx.cardigan.app) → apns-topic
//   APNS_PRODUCTION      — "false" to use the sandbox gateway (default prod;
//                          TestFlight + App Store both use the production
//                          gateway with aps-environment=production)
//
// Returns the same shape as sendFCM so the cron's send loop is uniform:
//   { ok: true }
//   { ok: false, terminal: true,  error }  — bad/expired token; delete the row
//   { ok: false, terminal: false, error }  — transient; retry next tick

import http2 from "node:http2";
import crypto from "node:crypto";

const HOST_PROD = "https://api.push.apple.com";
const HOST_SANDBOX = "https://api.sandbox.push.apple.com";

let _key = null;
let _keyResolved = false;
function getAuthKey() {
  if (_keyResolved) return _key;
  _keyResolved = true;
  const b64 = process.env.APNS_AUTH_KEY_BASE64;
  const raw = process.env.APNS_AUTH_KEY;
  let pem = "";
  if (b64) { try { pem = Buffer.from(b64, "base64").toString("utf8"); } catch { /* bad b64 */ } }
  else if (raw) pem = raw.replace(/\\n/g, "\n");
  _key = pem.includes("BEGIN PRIVATE KEY") ? pem : null;
  if (!_key) console.warn("[apns] APNS_AUTH_KEY(_BASE64) missing/invalid — iOS push disabled");
  return _key;
}

const teamId = () => process.env.APNS_TEAM_ID || process.env.APPLE_TEAM_ID || "";
const keyId = () => process.env.APNS_KEY_ID || "";
const bundleId = () => process.env.APNS_BUNDLE_ID || "mx.cardigan.app";
const useProduction = () => process.env.APNS_PRODUCTION !== "false";

export function apnsConfigured() {
  return !!(getAuthKey() && teamId() && keyId());
}

// Apple requires the auth JWT be refreshed every 20–60 min and reused in
// between (minting one per push gets you throttled with TooManyProviderTokenUpdates).
let _jwt = null;
let _jwtAt = 0;
function authJwt() {
  const now = Math.floor(Date.now() / 1000);
  if (_jwt && now - _jwtAt < 3000) return _jwt; // ~50 min
  const key = getAuthKey();
  const b64url = (b) => Buffer.from(b).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId() }));
  const claims = b64url(JSON.stringify({ iss: teamId(), iat: now }));
  const input = `${header}.${claims}`;
  const sig = crypto.sign("SHA256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  _jwt = `${input}.${sig}`;
  _jwtAt = now;
  return _jwt;
}

export async function sendAPNs({ token, payload }) {
  if (!apnsConfigured()) return { ok: false, terminal: false, error: "apns-not-configured" };
  if (!token) return { ok: false, terminal: true, error: "missing-token" };

  const body = JSON.stringify({
    aps: {
      alert: { title: payload?.title || "Cardigan", body: payload?.body || "" },
      sound: "default",
      // No badge: we don't track an unread count, so a static "1" would just
      // stick on the icon with no in-app way to clear it. The app also clears
      // any residual badge on launch (see AppDelegate in apply-ios-config.sh).
    },
    ...(payload?.url ? { url: String(payload.url) } : {}),
  });

  return await new Promise((resolve) => {
    let settled = false;
    let client;
    const done = (r) => {
      if (settled) return;
      settled = true;
      try { client?.close(); } catch { /* ignore */ }
      resolve(r);
    };
    try {
      client = http2.connect(useProduction() ? HOST_PROD : HOST_SANDBOX);
    } catch (err) {
      return resolve({ ok: false, terminal: false, error: err.message });
    }
    client.on("error", (err) => done({ ok: false, terminal: false, error: err.message }));

    const headers = {
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "authorization": `bearer ${authJwt()}`,
      "apns-topic": bundleId(),
      "apns-push-type": "alert",
      "apns-priority": "10",
    };
    if (payload?.tag) headers["apns-collapse-id"] = String(payload.tag).slice(0, 64);

    const req = client.request(headers);
    let status = 0;
    let data = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.setEncoding("utf8");
    req.on("data", (c) => { data += c; });
    req.on("end", () => {
      if (status === 200) return done({ ok: true });
      let reason = "";
      try { reason = JSON.parse(data || "{}").reason || ""; } catch { /* non-JSON */ }
      // 410 = device unregistered; 400 BadDeviceToken / DeviceTokenNotForTopic
      // are permanent for this token → caller deletes the row.
      const terminal = status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic";
      if (!terminal) console.error(JSON.stringify({ evt: "apns.send.error", status, reason }));
      done({ ok: false, terminal, error: reason || `status-${status}` });
    });
    req.on("error", (err) => done({ ok: false, terminal: false, error: err.message }));
    req.setTimeout(10000, () => done({ ok: false, terminal: false, error: "timeout" }));
    req.end(body);
  });
}
