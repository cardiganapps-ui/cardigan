import { createClient } from '@supabase/supabase-js'
import type { Database } from './types/supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// `experimental.passkey` opts this client into Supabase Auth's passkey
// (WebAuthn) beta — required for supabase.auth.signInWithPasskey() /
// registerPasskey() / passkey.* to exist. It's purely additive: every
// existing flow (email/password, Apple, magic link, MFA) is untouched.
// The user-facing passkey UI is separately gated behind
// VITE_PASSKEYS_UI_ENABLED + a WebAuthn feature check (see
// src/config/passkeys.js), so enabling the flag here can't surface a
// broken control before the Supabase dashboard side is configured.
//
// Typed against the generated Database schema (src/types/supabase.ts):
// table/column names and row shapes are checked at compile time, so a
// schema change that breaks a query fails `tsc` instead of at runtime.
// Regenerate the types after a migration with `npm run gen:types`.
export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: { experimental: { passkey: true } },
})
