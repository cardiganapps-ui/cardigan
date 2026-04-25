#!/usr/bin/env node
/**
 * One-time script to generate the RSA-OAEP keypair used for the
 * server-held recovery wrap on encrypted notes.
 *
 * Usage:
 *   node scripts/generate-notes-recovery-keypair.mjs
 *
 * Copy the output into your environment:
 *   VITE_NOTES_RECOVERY_PUBLIC_KEY  → client bundle (Vite + .env.local)
 *   NOTES_RECOVERY_PRIVATE_KEY      → server-only (Vercel env)
 *
 * Threat model: the public key encrypts a copy of every user's
 * note-encryption master key on setup. The matching private key
 * stays in the server env var and is only read by the admin
 * recovery endpoint. A Supabase DB compromise alone cannot decrypt
 * notes without ALSO obtaining this private key.
 *
 * Rotation: bump the KID column in user_encryption_keys, write a
 * one-shot migration script that recovers each user's master key
 * with the OLD private key and re-wraps with the NEW public key.
 * Then retire the old key.
 */

import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "der" },
});

const pubB64 = publicKey.toString("base64");
const privB64 = privateKey.toString("base64");

console.log("RSA-OAEP recovery keypair generated.\n");
console.log(`VITE_NOTES_RECOVERY_PUBLIC_KEY=${pubB64}`);
console.log(`NOTES_RECOVERY_PRIVATE_KEY=${privB64}`);
console.log("\nAdd both to your Vercel environment.");
console.log("VITE_NOTES_RECOVERY_PUBLIC_KEY also goes in .env.local for local dev.");
console.log("NOTES_RECOVERY_PRIVATE_KEY must NEVER leave the server.");
