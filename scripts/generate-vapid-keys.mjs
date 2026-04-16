#!/usr/bin/env node
/**
 * One-time script to generate VAPID keys for Web Push notifications.
 *
 * Usage:
 *   node scripts/generate-vapid-keys.mjs
 *
 * Copy the output into your Vercel environment variables:
 *   VITE_VAPID_PUBLIC_KEY  (also add to .env.local for local dev)
 *   VAPID_PRIVATE_KEY      (server-only, never expose to browser)
 */

import webpush from "web-push";

const vapidKeys = webpush.generateVAPIDKeys();

console.log("VAPID Keys Generated\n");
console.log(`VITE_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log("\nAdd these to your Vercel environment variables and .env.local");
