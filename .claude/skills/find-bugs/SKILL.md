---
name: find-bugs
description: Sweep the already-shipped codebase for bug classes that lint + vitest can't catch — prime-directive financial-integrity violations, enum/constraint mirror drift, silent UI failures, missing revert paths, auth/RLS gaps, design-system regressions, webhook/cron correctness, and date-format inconsistencies. Fans out parallel Explore agents per category, synthesizes findings into a ranked punch list. Pass a category name to scope (e.g. `/find-bugs financial`), `--effort low|medium|high|max` to tune depth, or `--fix` to apply the high-confidence findings after the report.
---

# /find-bugs

Bug-hunt the **already-merged** code (not the current diff — that's what `/code-review` is for). The bugs that hit production aren't the ones lint or vitest catch; they're the ones that look correct in isolation but violate an invariant that lives in another file. This skill's job is to know those invariants and check them.

## Invocation

- `/find-bugs` — run every category, effort `medium`.
- `/find-bugs <category>` — one category. Names: `financial`, `enums`, `silent-ui`, `state`, `auth`, `design`, `cron`, `dates`, `schema`.
- `/find-bugs --effort low|medium|high|max` — `low` = top-3 highest-yield categories with tight searches; `medium` = all categories, normal breadth; `high` = all categories with broader searches; `max` = all + speculative.
- `/find-bugs --fix` — after the report, apply the **high-confidence + low-blast-radius** findings to the working tree. Anything destructive or judgment-call stays in the report only.

## Orchestration

1. **Parse args.** Default = all categories, effort=medium, fix=false.
2. **Fan out.** For each category in scope, spawn an `Explore` agent in parallel (one tool-call block, multiple `Agent` calls). Each agent receives:
   - The category's checklist (below) verbatim
   - The past-bug example for that category as ground truth
   - Output schema: a JSON array of `{ file, line, pattern, severity, confidence, why, fix_hint }`
   - "Don't speculate. If you're not sure, omit it. False positives waste user time."
3. **Synthesize.** When all agents return:
   - Drop duplicates (same file:line + same pattern).
   - Rank by `severity` (critical > high > medium > low), then `confidence` (high > medium > low).
   - Group by category in the final report so the user can skim.
4. **Report.** Output format:
   ```
   ## Punch list — N findings (M critical, K high, …)

   ### 🔴 critical · financial
   - `utils/accounting.js:142` — SQL `session_counts_at` returns `true` for `cancelled` rows; JS predicate returns `false`. Drift since migration 071. **Fix:** mirror the JS branch in a new migration.

   ### 🟠 high · silent-ui
   - …
   ```
   Each finding is one line: `file:line` + 1-sentence why + 1-sentence fix hint. No prose.
5. **`--fix` step (only if flag set).** Walk the punch list top-down; apply any finding tagged `confidence=high` AND `severity ∈ {critical, high}` AND `fix_hint` is a concrete patch (not "investigate" / "consider"). Skip the rest. Report what was applied vs. skipped.

Don't write a planning doc, don't summarize back the categories at the end — the punch list is the deliverable.

---

## Categories

Each section below is the **complete prompt** to ship to that category's Explore agent. Keep them self-contained: the agent doesn't see this file, only the section you hand it.

### `financial` — prime-directive accounting integrity

The hottest path in this codebase. Violations corrupt the numbers therapists trust. Check:

1. **Insert paths into `sessions` that don't handle `23505` (unique violation).** The partial unique index `uniq_sessions_patient_date_time` will fire on `(patient_id, date, time)` collisions. Any insert that crashes on collision instead of skip/merge is a bug. Grep `.from("sessions").insert` and `.from('sessions').insert` across `src/hooks/`, `src/utils/`, `api/`. Same drill for `expenses` inserts vs. `uniq_expenses_recurring_period`.
2. **`enrichedSessions` being read by accounting code.** Accounting MUST use raw `upcomingSessions` + `sessionCountsTowardBalance`. Anything in `utils/accounting.js` or counter-computing code that touches `enrichedSessions` is a bug. Grep `enrichedSessions` and inspect callers.
3. **JS predicate ↔ SQL predicate drift.** `utils/accounting.js::sessionCountsTowardBalance` and `public.session_counts_at` in `supabase/schema.sql` must encode the same rules: `completed` → yes, `charged` → yes (no date gate), `scheduled` → yes only if `date + time + 1h <= now`, anything else → no. Read both. Note any branch present in one but not the other.
4. **Optimistic counter updates without a revert path.** Any place that does `patient.paid += x` (or similar) optimistically and `await supabase.update(...)` without capturing the prior value and restoring on error — that's a half-applied update waiting to happen. Look in `src/hooks/usePatients.js`, `useSessions.js`, `usePayments.js`. The pattern is: optimistic mutation → server call → no catch / catch without restore.
5. **New `SESSION_STATUS` values not represented in `sessionCountsTowardBalance`.** Read `src/data/constants.js::SESSION_STATUS`. For each status, confirm the predicate explicitly handles it (or falls through to `false`). A new status that silently falls through is a silent accounting regression.
6. **`computeAutoExtendRows` walking past `status='scheduled'` rows.** This was an actual phantom-session bug. Read `utils/recurrence.js` — confirm `scheduledRegular` is still filtered `date >= today` before feeding `schedMap`. If not, that's the bug back.

Past example: a phantom-recurring-sessions bug shipped because `computeAutoExtendRows` walked past `status='scheduled'` rows on slots the user had abandoned, regenerating future sessions on those slots. The fix was to filter to `date >= today` only.

### `enums` — constraint + mirror drift

Several enums are duplicated across JS constants, DB check constraints, and API allowlists. Drift between any of them is a runtime crash or silent allow-bypass. Check pairwise:

1. **`SESSION_STATUS`** in `src/data/constants.js` ↔ `sessions.status` check constraint in `supabase/schema.sql` ↔ any check constraint in `supabase/migrations/`. List the values in each set, diff them.
2. **`PAYMENT_METHODS`** in `src/data/constants.js` ↔ `payments.method` check constraint in `supabase/schema.sql`.
3. **`EXPENSE_CATEGORIES`** in `src/data/constants.js` ↔ `expenses.category` check constraint.
4. **`TAX_TREATMENTS`** in `src/data/constants.js` ↔ `expenses.tax_treatment` check constraint.
5. **`documents.kind`** check constraint ↔ whatever JS enum produces those values.
6. **`PROFESSION`** in `src/data/constants.js` ↔ `user_profiles.profession` check constraint ↔ `ALLOWED` in `api/admin-update-profession.js` ↔ keys in `src/i18n/vocabulary.js`. Four-way mirror; drift in any direction is a bug.
7. **`ADMIN_EMAIL`** constant ↔ `is_admin()` SQL function in `schema.sql`.

For each pair, output the diff (values in A but not B, vice versa) as separate findings.

### `silent-ui` — failure modes the user can't see

UI errors that don't surface to the user are the worst class — therapists hit them silently and lose trust. Check:

1. **`<img>` tags with `onError` that fall back to text without preserving a visible background.** The avatar bug: `onError` set `display:none`, leaving `background:transparent` — the colored initials fallback rendered transparent on the white card. Grep `onError` across `src/`. For each, trace the fallback path — does the parent have a visible non-transparent background? If not, flag.
2. **Bare `"Cargando…"` / `"Loading…"` strings instead of a `.sk-bar` / `.sk-circle` skeleton.** Per the design system: first paint should always feel like the destination. Grep for those strings; any in a primary screen (not a one-time modal) is a regression.
3. **Empty states using inline-styled centered text instead of `.empty-state`.** The codebase has a canonical `.empty-state` class. Hand-rolled centered-column empty states in `src/screens/` and `src/components/` are drift. Grep `text-align:.*center` + look for sibling "no hay" / "todavía" / "aún no" strings.
4. **Buttons/tappable elements that aren't `.btn` / `.btn-tap`.** A clickable `<div>` without `.btn-tap` has no press-feedback animation — feels inert vs. real buttons. Grep `onClick=` on `<div>` / `<span>` / `<img>` and check whether the inline `className` includes `btn` or `btn-tap`.
5. **Inline `rgba(0,0,0,...)` shadows or hex literals instead of `var(--shadow-*)`.** These don't flip in dark mode and end up muddy. Grep `rgba(0,0,0` and `box-shadow:.*#` across `src/styles/` and inline styles.
6. **Inline `background: "var(--cream)"` as an outer wrapper.** Per CLAUDE.md: cream is an accent, never a full-screen background. Grep for it on wrappers (`.shell`-equivalent surfaces).
7. **Try/catch blocks that swallow the error without surfacing to the user or to Sentry.** Pattern: `catch (e) {}` or `catch (e) { console.log(...) }` without `Sentry.captureException` or a `Toast` / `setError` call.

Past example: profile avatar set `display:none` on error, but the parent wrapper had `background:transparent`, so on the white Settings card the avatar became invisible. Fix was to always paint a colored backing, with the image masking it via `object-fit:cover` on success.

### `state` — optimistic updates + revert paths

Any mutation that updates local React state before the server confirms must capture the prior value and restore it on failure. Otherwise the UI lies after a network error.

1. **Hooks that update local state then `await` a Supabase write without a try/catch revert.** Pattern: `setState(newValue); await supabase.from(...).update(...);` with no error handler. Grep across `src/hooks/use*.js`.
2. **Hooks that call `recalcPatientCounters` in error paths but not in success paths where a counter drift could occur.** Look for asymmetric recalc usage.
3. **Module-level locks (`_extending`, etc.) that don't get reset on error.** A lock set in a try block must be cleared in a finally block; otherwise one network failure permanently blocks the operation.
4. **`useEffect` cleanups missing on async fetches.** Pattern: `useEffect(() => { fetch(...).then(setState); }, [...])` without a `cancelled = false` flag — setState fires after unmount.

### `auth` — JWT verification, RLS, service-role boundaries

The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS; misusing it is a data leak.

1. **Any `import` of `SUPABASE_SERVICE_ROLE_KEY` from a file under `src/`.** Service-role key must never appear in client code or anything that gets bundled to the browser. Grep `SUPABASE_SERVICE_ROLE_KEY` outside of `api/`.
2. **`api/` routes that use `getServiceClient()` without calling `requireAdmin(req, res)` or `verifyJwt(req)` first.** Read every file under `api/` (except `_*.js` helpers). For each `export default` handler, confirm the auth check happens before any service-role usage.
3. **Webhook routes that don't HMAC-verify the body.** `api/stripe-webhook.js`, `api/resend-webhook.js`, `api/whatsapp-webhook.js` should each verify a signature header with `crypto.timingSafeEqual`. Find any webhook handler that skips the check.
4. **Tables in recent migrations missing `enable row level security` + a policy.** Grep `create table` in `supabase/migrations/` and `supabase/schema.sql`; for each, confirm there's a corresponding `enable row level security` and at least one `create policy` (or a documented `is_admin()` policy).

### `design` — design-system regressions

The styles are the design system. Drift here doesn't crash but it looks like an outsider built the screen.

1. **`border-radius:` hard-coded to a number outside `--radius-*`.** Allowed: `var(--radius-sm)`, `var(--radius)`, `var(--radius-lg)`, `var(--radius-pill)`, or `9999px` (pill). Anything else is drift.
2. **Font sizes outside the `--text-*` scale.** Inline `font-size: 13px` (or any literal) when there's a token covers it.
3. **Sheet components missing `useEscape` + `useFocusTrap` + `useSheetDrag` wiring.** Grep `sheet-overlay` and verify each call site has all three hooks.
4. **Scroll surfaces without `.scroll-bounce` or `.page`.** Any element with `overflow-y: auto` (or `scroll`) in inline style or a CSS class — confirm `.scroll-bounce` or `.page` is also applied.
5. **Non-tabular numerals on money displays.** Grep money-display components (kpi, balance, payment) — confirm `font-variant-numeric: tabular-nums` is set somewhere up the tree.

### `cron` — webhook, cron, idempotency

1. **Inserts into `sent_reminders` that don't dedupe on `(session_id, user_id, channel)`.** The unique constraint is in place; any path that crashes on conflict instead of skipping is a bug.
2. **Cron endpoints that don't call `verifyCronSecret()`.** Grep `vercel.json` crons; for each `path`, confirm the handler starts with the verifier.
3. **Webhook handlers that disable `bodyParser` but still rely on `req.body`.** Pattern: `export const config = { api: { bodyParser: false } }` + later code reading `req.body.foo` (without manually parsing the raw stream).
4. **Edge Config flags that are referenced in code but not defined in `api/_flags.js`** (or vice versa). The reader has a documented default; missing flag = always-default behavior masquerading as a flag.

### `dates` — format consistency

Dates are stored as `"D-MMM"` Spanish strings (`"8-Abr"`). Anything else in `sessions.date` or `payments.date` is a regression.

1. **Calls to `new Date().toISOString().slice(0, 10)` etc. used as a session/payment date.** Should use `formatShortDate()` from `utils/dates.js`.
2. **`<input type="date">` values written directly to `sessions.date` without going through `isoToShortDate()`.** The input gives ISO; the DB stores short form.
3. **Date display strings that hard-code months (`["Enero", "Febrero", ...]`) instead of routing through `utils/dates.js`.**

### `schema` — schema.sql ↔ migrations ↔ live drift

The CI workflow `schema-drift.yml` catches some of this, but it only runs on changes to `supabase/`. Walk the inventory:

1. **Tables in `supabase/schema.sql` with no corresponding migration in `supabase/migrations/`** (excluding archive). These were created out-of-band in the dashboard.
2. **Migrations in `supabase/migrations/` that change a table not declared in `schema.sql`.** Drift in the other direction.
3. **DB triggers (`trg_*`) referenced in CLAUDE.md but missing from `schema.sql`.** Specifically `trg_payments_recalc_paid`, `trg_sessions_recalc_counters`, and the `session_counts_at` function — confirm presence.

---

## Severity rubric

- **critical** — data corruption, silent money-math drift, auth bypass, RLS hole. Cardigan's prime directive.
- **high** — user-visible bug (UI fails silently, button doesn't work, screen blank).
- **medium** — convention violation that will bite someone later (enum drift, missing skeleton).
- **low** — style/design-system drift, not a behavioral issue.

## Confidence rubric

- **high** — I read the code and verified the bug exists. Reproducible.
- **medium** — pattern matches a known bug class; would need a 30-second second look to confirm.
- **low** — heuristic flag; probably worth checking but might be a false positive.

Only `confidence=high + severity ∈ {critical, high}` findings are auto-applied under `--fix`.
