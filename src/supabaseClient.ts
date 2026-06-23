import { createClient } from '@supabase/supabase-js'

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
// NOT YET typed as createClient<Database> (src/types/supabase.ts). Doing
// so is the WS-6 end state, but it surfaces ~124 type errors across the
// data hooks (dynamic `.from(table)` unions, `.eq(col, undefined)`,
// insert shapes) that must be migrated call-site by call-site with app
// verification. The generated types + src/types/db.ts aliases are
// committed so that migration can proceed incrementally; flip this to
// <Database> once the hooks are typed.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { experimental: { passkey: true } },
})
