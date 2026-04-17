#!/usr/bin/env node
/**
 * Push Cardigan email templates to Supabase via the Management API.
 *
 * Usage:
 *   node scripts/push-email-templates.mjs
 *
 * Required env vars (in .env.local or exported):
 *   SUPABASE_PROJECT_REF  — the project ref (subdomain from your Supabase URL)
 *   SUPABASE_ACCESS_TOKEN — personal access token from https://supabase.com/dashboard/account/tokens
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const emailsDir = resolve(__dirname, '..', 'supabase', 'emails')

// Load .env.local if present
try {
  const envPath = resolve(__dirname, '..', '.env.local')
  const envFile = readFileSync(envPath, 'utf-8')
  for (const line of envFile.split('\n')) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*)$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
    }
  }
} catch { /* no .env.local, rely on exported env vars */ }

const projectRef = process.env.SUPABASE_PROJECT_REF
const accessToken = process.env.SUPABASE_ACCESS_TOKEN

if (!projectRef || !accessToken) {
  console.error('\nMissing required environment variables.\n')
  console.error('Add these to your .env.local file:\n')
  console.error('  SUPABASE_PROJECT_REF=your-project-ref')
  console.error('  SUPABASE_ACCESS_TOKEN=your-access-token\n')
  console.error('Get your project ref from: Supabase Dashboard > Project Settings > General')
  console.error('Get an access token from:  https://supabase.com/dashboard/account/tokens\n')
  process.exit(1)
}

// Read all four templates
const templates = {
  mailer_autoconfirm: false,
  site_url: 'https://cardigan-fawn.vercel.app',
  smtp_admin_email: 'cardigan.apps@gmail.com',
  mailer_templates_confirmation_content: readFileSync(resolve(emailsDir, 'confirm-signup.html'), 'utf-8'),
  mailer_templates_recovery_content: readFileSync(resolve(emailsDir, 'reset-password.html'), 'utf-8'),
  mailer_templates_magic_link_content: readFileSync(resolve(emailsDir, 'magic-link.html'), 'utf-8'),
  mailer_templates_email_change_content: readFileSync(resolve(emailsDir, 'change-email.html'), 'utf-8'),
  mailer_subjects_confirmation: 'Confirma tu cuenta — Cardigan',
  mailer_subjects_recovery: 'Restablecer contraseña — Cardigan',
  mailer_subjects_magic_link: 'Iniciar sesión — Cardigan',
  mailer_subjects_email_change: 'Confirmar nuevo correo — Cardigan',
}

console.log('Pushing email templates to Supabase project:', projectRef)

const res = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(templates),
  }
)

if (res.ok) {
  console.log('All 4 email templates + subjects updated successfully!')
} else {
  const body = await res.text()
  console.error(`Failed (${res.status}):`, body)
  process.exit(1)
}
