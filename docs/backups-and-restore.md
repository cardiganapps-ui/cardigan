# Backups & restore drill

Cardigan runs on Supabase Postgres + Cloudflare R2. Both have automatic
durability built in, but "automatic" without a tested restore is just
"we hope". This doc captures the procedure and the script that
exercises it.

## What's backed up automatically

- **Supabase Postgres** — daily full backup retained 7 days on the Pro
  plan (the project's default). PITR (point-in-time recovery) is NOT
  enabled (would require Pro+ add-on).
- **Cloudflare R2** — object versioning is OFF. Documents that the
  user deletes via `/api/delete-document` are gone immediately on the
  R2 side; the corresponding `documents` row in Postgres restores
  cleanly via the Postgres backup but the bytes are gone. Acceptable
  trade-off vs. the storage cost of versioning a per-user document
  set in MX (we would have to revisit if a user reports needing
  per-document version history).
- **Vercel deployments** — every git push to `main` archives the prior
  deploy; Vercel keeps them for the project's lifetime, so a one-tap
  "rollback to previous prod" is always available in the dashboard.

## Restore procedure (Supabase Postgres)

### Step 1 — pick the backup

```
curl -s -H "Authorization: Bearer $SUPABASE_PAT" \
  https://api.supabase.com/v1/projects/$SUPABASE_REF/database/backups \
  | jq '.backups[] | {id, status, inserted_at}'
```

Each backup has an `id` (UUID) and `inserted_at` timestamp. Pick the
one closest before the incident.

### Step 2 — restore to a new branch (preferred)

Branching is a paid feature — but for a real incident the cost (~$10
for the few hours we need the branch) is worth it.

```
# Create a branch
curl -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  https://api.supabase.com/v1/projects/$SUPABASE_REF/branches \
  -d '{"branch_name":"restore-test","region":"us-east-2"}'
# Restore the backup INTO the branch
curl -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
  https://api.supabase.com/v1/branches/<branch_id>/restore \
  -d '{"backup_id":"<backup_uuid>"}'
```

Sanity check the branch:

```
SUPABASE_REF=<branch_ref> SUPABASE_SERVICE_ROLE_KEY=<branch_key> \
  node --env-file=.env.local scripts/audit-accounting.mjs
```

If the audit comes back clean, point the production app at the
branch's connection string by updating `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in Vercel and redeploying.

### Step 3 — restore in place (last resort)

If branching isn't available, the dashboard's "Restore backup" button
restores into the same project, **destroying everything written
since**. Do this only if the incident makes the current data
unusable.

## Restore drill (script-driven)

`scripts/test-restore.mjs` exercises the restore path end-to-end on a
short-lived Supabase branch. It:

1. Creates a branch off the production project.
2. Picks the latest backup and restores it into the branch.
3. Runs `audit-accounting` against the branch.
4. Reports drift / duplicates and the timing of each step.
5. Deletes the branch.

Run quarterly so we know the restore path actually works:

```
node --env-file=.env.local scripts/test-restore.mjs
```

The script aborts cleanly if any step fails; it never touches the
production project's data.

## Manual checklist (incident response)

- [ ] Acknowledge the incident in Sentry / on the user-reported issue.
- [ ] Capture the wall-clock time and the latest pre-incident backup id.
- [ ] If accounting drift is suspected, run `audit-accounting.mjs`
      against PROD before restoring — the diff between
      pre-/post-restore tells you whether the restore actually fixed
      what you thought it did.
- [ ] Restore to a branch (Step 2) and run the audit there.
- [ ] If the branch looks clean, swap the env vars and redeploy.
- [ ] After the incident: post-mortem in `/docs/incidents/`,
      including the audit diff and the restore wall-clock time.
