# Production deploy gating (WS-1)

## Why

Until this change, **Vercel auto-deployed every push to `main` independently of
CI**. A red build — a failed accounting-predicate parity job, a broken
money-write E2E, a type error — still shipped to https://cardigan.mx. All of CI
was advisory. (The header of `.github/workflows/ci.yml` admitted this.)

The fix makes the live deploy **downstream of every quality gate**: the
`deploy-production` job in `ci.yml` runs only on a push to `main`, and only
after `lint`, `typecheck`, `unit`, `parity`, and `e2e` are green. Vercel's own
git auto-deploy is turned off so it can't ship around the gate.

## Current state (prepared, NOT yet active)

- ✅ `deploy-production` job added to `ci.yml`. It **self-skips** while
  `VERCEL_TOKEN` is absent (same guard pattern as `e2e-staging`), so merging
  this branch changes nothing about how deploys work today — Vercel keeps
  auto-deploying `main` exactly as before, and the new job no-ops.
- ⏳ Activation is a deliberate one-time cutover (below). It was **not** done
  automatically because the GitHub PAT available in the work session lacked
  `secrets:write` and `administration` (both 403), so the secrets and branch
  protection could not be set programmatically.

## Cutover — do these together, in order

Do **all** of step 1 before step 2, or `main` will have no deploy path between
them.

### 1. Add the three GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|--------|-------|
| `VERCEL_TOKEN` | a Vercel access token with deploy rights on the `cardigan` project |
| `VERCEL_ORG_ID` | `team_0rR9OfIKmnJ8xFDrOXUkHcT3` |
| `VERCEL_PROJECT_ID` | `prj_b7BGSTkTKwLT1aeKPEiKxAlz9Nmk` |

Once `VERCEL_TOKEN` exists, the `deploy-production` job stops self-skipping and
starts deploying on the next push to `main`.

### 2. Turn OFF Vercel's own git auto-deploy for `main`

The clean, version-controlled way — add to `vercel.json` (do this in the same
commit/PR as you flip the cutover so it lands on `main` atomically):

```json
"git": { "deploymentEnabled": { "main": false } }
```

This disables Vercel's automatic production deployments from `main` while
leaving branch/PR **preview** deploys intact. After this, the only thing that
ships production is the gated `deploy-production` job.

(Equivalent dashboard path if you prefer: Project → Settings → Git.)

### 3. Add branch protection on `main`

Repo → Settings → Branches → add a rule for `main`:

- Require status checks to pass before merging: `Lint`, `Typecheck (tsc)`,
  `Unit tests (vitest)`, `Accounting predicate parity (JS↔SQL)`,
  `E2E smoke (playwright)`.
- Require a pull request before merging (so the checks actually gate — direct
  pushes bypass required checks).

### 4. Verify

1. Push a trivial no-op commit to `main` → confirm `deploy-production` runs
   after the gates and the site updates.
2. Push a commit that deliberately fails a unit test on a branch, open a PR →
   confirm it cannot merge, and that production does **not** change.
3. Revert the deliberate failure.

## Rollback

Re-enable Vercel auto-deploy (remove the `vercel.json` `git` block or flip the
dashboard toggle) and the previous behaviour returns immediately. The
`deploy-production` job self-skips again if you remove `VERCEL_TOKEN`.
