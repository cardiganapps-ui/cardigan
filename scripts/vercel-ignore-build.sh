#!/usr/bin/env bash
# vercel-ignore-build.sh — CI gate for Vercel production deploys.
#
# WHY: Vercel's Git auto-deploy is independent of GitHub Actions, so a
# commit that fails Lint / Unit tests / E2E can still ship to production.
# This script, wired as the Vercel project's "Ignored Build Step",
# blocks a PRODUCTION build unless every required CI check is green on
# the exact commit being deployed.
#
# VERCEL CONTRACT (important — the exit codes are inverted vs. intuition):
#   exit 1  → "proceed WITH the build" (deploy)
#   exit 0  → "ignore / SKIP the build" (do not deploy)
#
# BEHAVIOUR:
#   • Preview deploys (VERCEL_ENV != "production") → always build (exit 1)
#     so branch previews are never blocked.
#   • Production → query GitHub's combined commit status + check-runs for
#     VERCEL_GIT_COMMIT_SHA. Build (exit 1) only if ALL required checks
#     succeeded; otherwise skip (exit 0) so a red commit never reaches
#     prod.
#   • Fail-OPEN on any API/token error (exit 1 → build) so a GitHub
#     outage or a missing token can't wedge all deploys. The gate is a
#     safety net, not a single point of failure.
#
# ENABLE (one-time, deliberate — do this watched, not unattended):
#   1. In Vercel → Project → Settings → Git → "Ignored Build Step":
#        bash scripts/vercel-ignore-build.sh
#   2. Add a GitHub token with `repo:status` read to the Vercel project's
#      env as GH_STATUS_TOKEN (a fine-grained PAT, read-only on Contents/
#      Checks is enough).
#   3. Make Lint / "Unit tests (vitest)" / "E2E smoke (playwright)"
#      REQUIRED status checks on `main` (branch protection) WITHOUT
#      "include administrators", so an admin can still force a deploy in
#      an incident.
#   4. TEST before relying on it: run with VERCEL_ENV=production and
#      VERCEL_GIT_COMMIT_SHA set to a known-green SHA (expect exit 1) and
#      a known-red SHA (expect exit 0).
#
# Required env at runtime: VERCEL_ENV, VERCEL_GIT_COMMIT_SHA,
# GH_STATUS_TOKEN, and GH_REPO (defaults to cardiganapps-ui/cardigan).

set -euo pipefail

REPO="${GH_REPO:-cardiganapps-ui/cardigan}"
SHA="${VERCEL_GIT_COMMIT_SHA:-}"
ENVIRONMENT="${VERCEL_ENV:-production}"
TOKEN="${GH_STATUS_TOKEN:-}"

# The CI check names that must be green (must match ci.yml job names).
REQUIRED_CHECKS=("Lint" "Unit tests (vitest)" "E2E smoke (playwright)")

build()  { echo "vercel-ignore-build: BUILD ($1)"; exit 1; }   # proceed
skip()   { echo "vercel-ignore-build: SKIP ($1)";  exit 0; }   # ignore

# Preview/branch deploys are never gated.
[ "$ENVIRONMENT" != "production" ] && build "non-production env ($ENVIRONMENT)"

# Fail-open if we can't evaluate the gate.
[ -z "$SHA" ]   && build "no commit SHA — fail open"
[ -z "$TOKEN" ] && build "no GH_STATUS_TOKEN — fail open"

api() {
  curl -fsS -H "Authorization: Bearer $TOKEN" \
       -H "Accept: application/vnd.github+json" \
       "https://api.github.com/repos/$REPO/commits/$SHA/$1" 2>/dev/null
}

# Combined status (classic statuses) + check-runs (GitHub Actions) both
# feed the same commit; gather conclusions from both surfaces.
checks_json="$(api "check-runs?per_page=100" || true)"
[ -z "$checks_json" ] && build "GitHub API unreachable — fail open"

# For each required check, confirm a run exists and concluded "success".
for name in "${REQUIRED_CHECKS[@]}"; do
  concl="$(printf '%s' "$checks_json" \
    | python3 -c "import sys,json
d=json.load(sys.stdin)
runs=[r for r in d.get('check_runs',[]) if r.get('name')=='''$name''']
print(runs[0].get('conclusion','') if runs else 'missing')" 2>/dev/null || echo "error")"
  case "$concl" in
    success) ;;                                   # this check is green
    missing) skip "required check '$name' not found on $SHA" ;;
    error)   build "could not parse checks — fail open" ;;
    *)       skip "required check '$name' = '$concl' (not success)" ;;
  esac
done

build "all required checks green on $SHA"
