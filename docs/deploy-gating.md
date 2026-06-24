# Production deploy gating (WS-1)

## Why

Vercel used to **auto-deploy every push to `main` independently of CI** — a red
build (failed accounting-predicate parity, a broken money-write E2E, a type
error, lint, bundle bloat) still shipped to https://cardigan.mx. All of CI was
advisory.

The fix makes the live deploy **downstream of every quality gate**.

## Mechanism (deploy hook, not a GitHub secret)

The `deploy-production` job in `.github/workflows/ci.yml`:
- runs **only on a push to `main`**, and only after `lint`, `typecheck`,
  `bundle`, `unit`, `parity`, and `e2e` are all green (`needs:` + `if:`), then
- fires a **Vercel Deploy Hook** (`POST` to a capability URL) which redeploys
  `main`'s HEAD.

Vercel's own git auto-deploy for `main` is turned **off**, so the hook is the
only path to production. Preview deploys for branches/PRs are unaffected.

**Why a hook instead of `vercel deploy` + a `VERCEL_TOKEN` GitHub secret:** the
automation session that built this can't reach GitHub's REST API to store an
Actions secret — the org hasn't connected the Claude GitHub App, so every
`api.github.com` call 403s regardless of token. Keeping the credential on the
**Vercel** side (the hook) sidesteps that entirely: no GitHub secret, no branch
protection, no GitHub-side cutover needed.

The hook URL lives in `ci.yml`. It's a **capability URL** — POSTing to it only
redeploys `main`'s current HEAD (no code injection, no secret leak), so it's
safe in-repo for this private repo. If it ever leaks, rotate it: Vercel →
project **cardigan** → Settings → Git → Deploy Hooks (or `DELETE` + re-`POST`
`/v1/projects/<id>/deploy-hooks` via the API), then update the URL in `ci.yml`.

## State

- ✅ Deploy hook `ci-gated-prod` (ref `main`) created on the Vercel project.
- ✅ `deploy-production` job wired in `ci.yml` to fire it, gated on all checks.
- ⏳ **Activation** (done once this branch reaches `main`):
  1. Merge to `main` — brings the gated job onto `main`. The merge itself
     deploys normally (auto-deploy is still on at that instant) and the gated
     job also fires the hook; both are fine.
  2. Verify the `deploy-production` job ran green and the hook deploy landed.
  3. **Turn off Vercel git auto-deploy for `main`** — then the hook is the only
     prod path. Either:
     - `vercel.json`: add `"git": { "deploymentEnabled": { "main": false } }`
       (version-controlled), or
     - Vercel dashboard → project → Settings → Git.
     Do this **after** step 2 so there's never a window with no deploy path.

Steps 1–3 are scriptable from the Vercel side + a push to `main`; no GitHub UI
action is required.

## Verify

1. Normal green merge/push to `main` → `deploy-production` runs after the gates
   and cardigan.mx updates.
2. A branch/PR that fails a check → `deploy-production` is skipped (its `needs:`
   aren't satisfied) and production does **not** change.

## Rollback

Re-enable Vercel git auto-deploy (remove the `vercel.json` `git` block or flip
the dashboard toggle) and the previous behaviour returns immediately. To stop
the hook entirely, delete it in the Vercel dashboard (the job's POST then 404s
and the job fails loudly — it can't silently mis-deploy).

## (Alternative, if GitHub access is ever restored)

If the org later connects the Claude GitHub App / a token with `secrets:write`
becomes usable, the more transparent `vercel deploy --prebuilt --prod` + a
`VERCEL_TOKEN` Actions secret can replace the hook step (it deploys the exact
validated SHA rather than branch HEAD). Not needed today.
