# Cardigan — Elite Product, Design & Engineering Review

> Review committee perspective (Stripe / Vercel / Figma / Linear / Apple / Airbnb / a scaling CTO / a VC partner).
> Benchmarked against the top 1% of software, not against average startups.
> Evidence is cited as `path:line`. Severities are recalibrated against real exploitability/impact — several
> sub-findings surfaced during the audit were over- or under-stated and are corrected here.

---

## Executive Summary

Cardigan is a mobile-first PWA (+ Capacitor iOS/Android) for solo health/education practitioners in Mexico to
run their practice: patients, recurring sessions, payments, notes, documents, expenses, billing. It is ~102K LOC
across ~500 files, plain JS/JSX migrated to **fully strict TypeScript** (`tsconfig.json` `allowJs:false`,
`strict:true`), React 19 + Vite, Supabase (Postgres + RLS), Vercel serverless (`api/`, 78 routes), Cloudflare R2.

The single most important thing to understand about this product is that **it knows what it is.** The README and
`CLAUDE.md` "Prime Directive" both state the thesis plainly: the number that matters is *who owes me money*, and
the entire architecture is a defensively-engineered billing engine — one canonical `amountDue` formula, mirrored
in a SQL trigger predicate, reconciled by DB triggers, re-derived nightly by an audit script, and locked down by
a 518-line test suite with named regression tests for real bugs that shipped. **This is genuinely top-1%
engineering judgment for the core domain.** Very few teams — at any size — protect their crown-jewel invariant
this well.

The gap between that core and the rest of the app is the story of this review. The financial kernel is
fortress-grade; the surrounding application is a **collection of god-files** (`App.tsx` 2,551 lines, `Settings.tsx`
2,344, `useCardiganData.ts` 1,249), a **70-key untyped context bag**, and a **product surface that has sprinted far
ahead of its validation** — passkeys, WhatsApp reminders, Stripe Connect, iCal feeds, at-rest note encryption,
OCR receipts, a referral engine, social sign-in — all shipped for a pre-PMF, single-market, ~$8/mo product built
(per `git shortlog`) essentially by one agent-driven contributor.

**Overall: B+ (83/100).** Exceptional craft in the places that carry financial and security risk; real
architectural and test debt in the application shell; and a product-strategy question — breadth bought at the
expense of depth — that a disciplined team would have answered differently.

---

## Overall Score: 83 / 100 — **B+**

| Category | Score | Tier vs. top products |
|---|---|---|
| Product | 78 | Top 10% |
| UX | 80 | Top 10% |
| Visual design | 90 | Top 5% |
| Design system | 89 | Top 5% |
| Frontend engineering | 77 | Top 10–25% |
| Backend & architecture | 85 | Top 5–10% |
| Performance | 78 | Top 10–25% |
| Security | 84 | Top 5–10% |
| Testing & correctness | 76 | Top 10% (bimodal) |
| Craftsmanship | 88 | Top 5% |

---

## Product Review — 78/100

**What problem does it solve?** Solo practitioners run their practice from spreadsheets + WhatsApp and routinely
get the one number wrong that matters: who owes them. Cardigan makes that number trustworthy. The problem is real,
the wedge is sharp, and the README articulates it better than most seed-stage decks.

**Is the solution compelling?** For the core loop — add patient → recurring schedule auto-extends → mark/auto-
complete sessions → record payments → see balance — yes. The auto-extend + auto-complete + canonical balance
machinery is the actual product, and it's good.

**Deductions:**
- **−12 — Feature sprawl far ahead of PMF.** The codebase carries passkeys (`docs/passkeys-native-plan.md`),
  WhatsApp Cloud API reminders, Stripe *Connect* patient payments (`api/stripe-connect-*.ts`), iCal feeds
  (`api/_calendar.ts`), opt-in AES-256 note encryption (`src/lib/cryptoNotes.ts`), OCR receipts
  (`api/ocr-receipt.ts`), and a referral-credit system (`api/referral-code.ts`). Each is individually competent.
  Collectively, for a product that hasn't demonstrated retention, this is **capital spent on optionality instead
  of validation.** Linear/Notion at this stage shipped *one* thing exceptionally; this ships fifteen things well.
- **−6 — Monetization vs. effort mismatch.** Cardigan Pro is $149 MXN/mo (~$8). The engineering surface implies a
  product priced 5–10x higher. The unit economics of supporting WhatsApp templates, Stripe Connect, R2 storage,
  and Anthropic OCR against an $8 ARPU are not obviously sound.
- **−4 — "Solo practitioner, all professions" is a positioning hedge.** Profession enum spans psychologists,
  nutritionists, tutors, music teachers, trainers (`data/constants.ts::PROFESSION` mirrored in 4 places). Serving
  everyone is a way of being sharp for no one; the vocabulary-swap i18n is clever but it papers over an unmade
  segmentation decision.

**Missing / unfinished:** No analytics on activation or retention surfaced anywhere; no in-product way to learn
whether the trial→paid funnel works (the thing an investor most wants). The thing most *built* is the thing least
*measured*.

---

## UX Review — 80/100

**Strengths (genuinely top-tier):**
- **Undoable deletes** with a 3s window + `visibilitychange` handling for backgrounded tabs (`App.tsx`
  `withUndoableDelete` ~1768–1803). This is Linear-grade interaction polish.
- **Skeleton-first loading** that mirrors the destination layout (`App.tsx::LoadingSkeleton`,
  `PatientHome.tsx::PatientHomeSkeleton`) — no bare "Cargando…" strings.
- **Empty/loading/error states are systematized** via `.empty-state` classes, not hand-rolled per screen.
- Command palette + keyboard shortcuts (Cmd/Ctrl+K, `/`, Cmd/Ctrl+N) on a *mobile* app shows real care for the
  power user who lands on desktop.
- Optimistic mutations with explicit revert-on-error paths, tested (`useSessions.test.ts`, `usePayments.test.ts`).

**Friction / issues, by severity:**

| Sev | Issue | Root cause | Fix |
|---|---|---|---|
| High | **Skip-to-content link targets a non-existent id.** `App.tsx:2034` links to `#main-content`; no element exposes that id. Keyboard/AT users hit a dead anchor. | Affordance added without a destination | Add `id="main-content"` to the main scroll container |
| High | **`contenteditable` Markdown editor has no ARIA live region** (`components/notes/MarkdownEditor.tsx`). Screen-reader users get no feedback as text is inserted/deleted in the app's most-used surface. | Custom caret/model engine bypassed semantic feedback | Add a polite live region or fall back to a labeled textarea path |
| Med | **Modal/sheet dialogs lack `aria-label`/`aria-labelledby`** in places (e.g. Settings notifications sheet ~`Settings.tsx:834` has `role="dialog" aria-modal` but no name). AT announces only "dialog". | Inconsistent ARIA discipline | Label every dialog by its title node |
| Med | **Focus traps are applied unevenly.** `useFocusTrap` is wired on some sheets (Settings) but not all (e.g. `ExpenseSheet`, `NewPatientSheet` per audit). Keyboard focus can escape behind the scrim. | No shared sheet primitive enforcing the trap | Centralize sheet composition so the trap can't be forgotten |
| Med | **Single ErrorBoundary at the root** (`components/ErrorBoundary.tsx`, mounted once in `App.tsx:2026`). A crash in Notes unmounts the entire app to one generic "Algo salió mal." | No per-screen boundaries | Wrap each major screen; keep the chunk-reload recovery it already does well |

The ErrorBoundary itself is *well-built* — it detects stale-chunk `ChunkLoadError`, busts caches, and reports to
Sentry with component stack. It just has blast-radius-of-one coverage.

---

## Visual Design Review — 90/100

This is the strongest dimension. The design feels **premium**, not generic. Evidence:

- **Tokenized everything:** ~105 CSS variables (`styles/base.css`) covering a `--text-*` modular scale driven by a
  single `--text-scale` multiplier (so iPad/desktop reflow by changing one value), a coherent spacing/radius set,
  a documented 4-easing/4-duration motion language, and a z-index scale with named tiers.
- **Dark mode is first-class** (`styles/dark.css`): it overrides *tokens*, status colors become alpha-tints, and
  brand colors (Google white, Apple black, WhatsApp green) are deliberately held constant with annotations.
- **Meticulous safe-area handling** (`--sat`/`--sab`, `env()` + `max()`), `@media (hover:hover)` gating so touch
  devices don't get sticky hover states, `:focus-visible` outlines that are tone-adjusted per surface.

**Deductions:**
- **−5 — Dark-mode shadow tokens are copy-pasted, not parameterized** (`dark.css:59–64` repeats all five shadows
  with new alphas). DRY violation; a blur change means editing two places.
- **−3 — One real cross-mode bug:** `.input:focus` uses a literal `box-shadow: 0 0 0 3px rgba(91,155,175,0.13)`
  (`components.css:1018`) instead of `var(--teal)`-derived; the focus ring shows the light-mode teal on dark inputs.
- **−2 — Scattered one-off values** (`gap:10px`, `padding:6px`) outside the `--space-*` scale, and ~15–20
  hardcoded hex/rgba literals in component JSX fallbacks that won't flip in dark mode.

These are second-polish-pass items, not regressions. A Figma/Linear designer would approve of the system and
nitpick exactly these edges.

---

## Design System Audit — 89/100

Reverse-engineered: 16 CSS files (~11.9K lines) aggregated via `index.css`, ~1,338 distinct classes, ~105 tokens,
~15 button variants, 20+ documented keyframes, 5 accent themes (default + sage/amber/burgundy/steel) each with
light+dark variants and **no color bleed**. Component primitives (`.btn-*`, `.card`, `.row-item`, `.sheet-*`,
`.input`) are used consistently and every button variant has a defined dark path.

**Scale verdict:**
- 20 screens: trivial. 100 screens: holds. 500 screens / multiple teams: **boundary.** Class inventory grows ~1:1
  with screens (200+ screen-specific classes already), and **2,453 inline `style={{…}}` occurrences across 181
  files** is the real design-system leak — Settings.tsx alone has ~177. Inline styles can't be theming-audited,
  can't be media-queried, and silently bypass the token layer (the dark-mode hex fallbacks above are a symptom).

**Highest-leverage design-system fix:** route-based CSS splitting + migrating the top ~150 most-frequent inline
styles to semantic classes, before the screen count doubles.

---

## Frontend Engineering Review — 77/100

**The god-file problem is the headline.** Three files concentrate disproportionate complexity:

- **`App.tsx` (2,551 lines)** owns auth/MFA/verification/onboarding gates, **30+ modal/sheet `useState`s**, ~20
  `useEffect` blocks (trial reminders, rating prompts, passkey nudges, subscription-success confetti), native
  edge-swipe gesture handling, and a **`ctxValue` memo with 39 dependencies** (~1804–1933) — meaning a single
  toast or subscription tick re-creates the context object and ripples through every consumer.
- **`Settings.tsx` (2,344 lines)** is a kitchen sink: 8 inline panels + 11 inline sheets + ~177 inline styles.
- **`useCardiganData.ts` (1,249 lines)** is "one hook to rule them all": 15 parallel fetches in a single
  `Promise.all` (any one failure re-runs the whole hydration), two auto-extend passes guarded by **module-level
  locks that don't coordinate across tabs**, recurring-expense generation, and ~6 expensive memos.

**Context is an untyped 70-key bag** (`CardiganContext` typed `Record<string, any>` as a migration bridge). React
context isn't granular, so any change re-renders all consumers; `Home.tsx:87` destructures 21 keys at once. This
works today and will get expensive on low-end devices as the app grows.

**Type safety is a real strength, with one honest seam:** strict TS everywhere *below* the data layer, but the
coordinator and context use `type Row = any` because the Supabase client is untyped. The fix exists and is unused:
`supabase gen types` would catch schema drift at compile time instead of at render time.

**What's right:** aggressive, well-orchestrated lazy-loading (40+ `React.lazy` + idle prefetch); domain action
hooks (`usePatients/useSessions/...`) are cleanly separated even though their coordinator isn't; the
`MarkdownEditor` *explicitly documents* its intentional stale-closure-via-refs strategy (self-aware, not
accidental). The engineering is competent — it's the **module boundaries that are wrong**, not the logic.

---

## Backend & Architecture Review — 85/100

This is more disciplined than the frontend.

- **RLS is comprehensive:** every user table carries `auth.uid() = user_id`; admin read-all uses a
  `security definer` `is_admin()` with `set search_path = ''` (correctly hardened — see git log `0536819`).
- **The denormalized-counter design is correct:** `patient.paid/billed/sessions` are maintained by DB triggers
  (`trg_payments_recalc_paid`, `trg_sessions_recalc_counters`) running a SQL predicate `session_counts_at` that
  **mirrors** the JS `sessionCountsTowardBalance`, with timezone awareness and `created_at`-anchored year
  inference. This is the kind of dual-write-avoidance most teams get wrong.
- **Auth-before-service-role is enforced by a build gate:** `scripts/audit-api-auth.mjs` runs in `prebuild` and
  fails the build if any route touches `getServiceClient()` before authenticating. A custom lint for the exact
  footgun that matters.
- **Webhooks are HMAC-verified with constant-time compares** (`api/_stripe.ts`, mirrored in resend/whatsapp), and
  Stripe events are idempotency-deduped via `stripe_webhook_events(event_id)` with explicit stale-event ordering
  logic (`stripe-webhook.test.ts` covers the orphan-cancel race).

**Scaling outlook:** 1K users trivial; 10K fine; 100K plausible. Predicted first bottlenecks at 100K+:
(1) the 15-query `Promise.all` cold-start per session has no granular retry and re-runs wholesale on any failure;
(2) cross-tab auto-extend relies on a unique index to catch session dupes but not to *prevent* the redundant work;
(3) `send-session-reminders` cron fan-out via `Promise.allSettled` is fine but unsharded.

**Legitimate findings (recalibrated):**
- *Medium* — **Resend webhook lacks event-level idempotency** (only a 5-min timestamp tolerance), unlike Stripe.
  Replayable within the window; appends duplicate `resend_events` rows.
- *Medium* — **Rate limiter fails open** (`api/_ratelimit.ts` returns `ok:true` on DB error). A deliberate
  hot-path choice, backstopped by the Vercel firewall's 120 req/min/IP, but it weakens the patient-claim
  token-guess defense if the `rate_limits` table is saturated.
- *Medium* — **Not all state-changing patient-portal endpoints are rate-limited** (claim/intake are; reschedule
  appears not to be), enabling row/email flooding by a token holder.
- *Low* — **No audit-log entries for patient-side actions** (claim/intake/cancel) despite an `admin_audit_log`
  table existing; disputes have no server trail.

---

## Performance Review — 78/100

- **Build:** manual chunks + `chunkSizeWarningLimit:600` (`vite.config.js`), sourcemaps only when Sentry is wired
  (no prod source leak), aggressive route splitting. Cold start is well-managed.
- **Runtime risks:** the 39-dep `ctxValue` memo + non-granular context means broad re-render fan-out; the
  `MarkdownEditor` re-renders all lines on each keystroke (the author measured ~8ms/500-line note and accepted it —
  fine on modern phones, marginal on a 2016 iPhone).
- **Under 100x traffic:** what breaks first is the per-session 15-query hydration and the unsharded reminder cron;
  what gets *expensive* is Anthropic OCR and R2 egress against an $8 ARPU; what gets *slow* is nothing
  catastrophic — the architecture is read-light and Postgres-backed.

No real load testing or performance budget is evident — the standard gap for a solo/early product.

---

## Security Review — 84/100

**Posture is good** — better than the raw audit suggested. Two headline "criticals" from the first-pass audit are
**corrected here:**

- ❌ *Not a vuln* — "RLS write policies missing `WITH CHECK`." Postgres **defaults `WITH CHECK` to the `USING`
  expression** when omitted, so `for all using (auth.uid() = user_id)` *does* block inserting/updating rows owned
  by another user. Verified across `supabase/schema.sql:674–690`. Adding explicit `WITH CHECK` is defense-in-depth
  hygiene, not a fix for an exploit.
- ❌ *Not a vuln* — "JWT verified by trusting the SDK." `api/_admin.ts` uses `supabase.auth.getUser(token)`, which
  **validates the token against the auth server**, the officially recommended secure pattern — strictly stronger
  than local-only signature decode.

**Real findings:**

| Sev | Finding | Evidence |
|---|---|---|
| Medium | Resend webhook replay window (no event dedupe) | `api/resend-webhook.ts` |
| Medium | Rate limiter fails open on DB error | `api/_ratelimit.ts` |
| Medium | Reschedule (and possibly other patient-portal mutations) not rate-limited | `api/patient-reschedule-session.ts` |
| Low | Admin email hardcoded in **three** places incl. client bundle (`src/data/constants.ts:143`, `_admin.ts`, `schema.sql is_admin()`). Single-admin app and the email grants nothing without a JWT, so impact is operational/opsec, not access. A single source + admin-table lookup would de-duplicate. |
| Low | Patient medical fields (allergies/conditions) stored plaintext while *notes* are encryptable; RLS + Postgres at-rest encryption cover the common case, LFPDPPP-sensitive under a DB-level compromise |

**Genuinely strong:** the note-encryption design is cryptographically sound — AES-256-GCM, PBKDF2-SHA256 @ 600k
iters, 16-byte salt + fresh 12-byte IV per op (no reuse), RSA-OAEP-2048 recovery wrap with a server-only private
key; a Supabase-only breach yields ciphertext + wraps, neither decryptable without the passphrase or the server
key (`src/lib/cryptoNotes.ts`, tests in `cryptoNotes.test.ts`). Two-vector compromise required — exactly the
stated threat model.

---

## Testing & Correctness Review — 76/100 (bimodal)

**Fortress half:** `accounting.test.ts` (518 lines, ~27 cases) covers every predicate branch — completed/charged/
past-scheduled-with-1h-grace/future/cancelled, rate changes, opening balance, interview rate=0, a dev-mode
assertion that `enrichedSessions` can never leak into accounting math, and a memo-split-equivalence check.
`recurrence.test.ts` (636 lines) has **named regression tests** for shipped bugs (phantom slots, year-boundary
mis-inference) that deliberately use `status=SCHEDULED` because the earlier `COMPLETED` variant passed *despite*
the bug. `audit-accounting.mjs` re-derives every balance from raw rows nightly. Optimistic-update revert paths and
Stripe event ordering are tested with real assertions, not smoke. **This is top-1% discipline.**

**Thin half:**
- **7 of 15 main screens have zero tests** — including `Home.tsx`, `Finances.tsx`, `Patients.tsx`, `Settings.tsx`,
  `App.tsx`. A regression in the *display* of a correct balance ships silently; the audit catches the *math* days
  later, but users see the wrong number first.
- The 1,249-line coordinator `useCardiganData` is tested only at the `mapRows`/`isAdmin` helper level — the fetch/
  enrich/auto-extend orchestration is untested.
- **E2E is demo-mode smoke only** (Playwright, ~6 thin specs, no real auth, no DB writes, no mutation flows). It
  catches TDZ/render crashes, not product regressions.
- **The JS↔SQL predicate parity has no automated test** — the audit script is the only net, and it runs against
  live data, not in CI on a fixture.

---

## Craftsmanship Review — 88/100

Does it feel intentional? **Overwhelmingly yes** in the core, and the artifacts prove it: a Prime-Directive doc
that reasons through the accounting invariant; regression tests that encode *why* a prior test was insufficient;
a build-time auth audit; a schema-drift CI guard; comments that record hard-won lessons (the VAPID `.trim()` that
cost 2 hours; the `interactive-widget` viewport experiment that caused iOS lag). This is the work of someone who
has been burned and built guardrails. It demonstrates taste and restraint *in the domain that matters*.

Where it slips: the god-files and the 2,453 inline styles betray velocity-over-structure at the app shell, and the
sheer feature count betrays a *lack* of restraint at the product level. The craftsmanship is real but unevenly
distributed — surgical around money, sprawling around everything else.

---

## Investor Review — would I invest? — 78/100

**Confidence-builders:** the execution velocity and engineering judgment per dollar are extraordinary (98 commits,
essentially one agent-driven contributor, shipping a financially-correct, secure, multi-platform app with billing,
encryption, and native shells). The core insight — *trust in one number is the product* — is correct and well
executed. Whoever/whatever is driving this can build.

**Blockers:**
1. **No retention/activation evidence.** The most-built product is the least-measured. I cannot see a funnel.
2. **Weak defensibility.** Spreadsheet-replacement for solo practitioners is a crowded, low-switching-cost space;
   nothing here is a moat (the accounting rigor is table stakes once copied).
3. **ARPU vs. cost structure.** $8/mo against WhatsApp/Stripe-Connect/OCR/R2 cost surface is unproven.
4. **Bus factor / team signal.** A single (AI) contributor is a strength for cost and a question for durability.

**Verdict:** I'd take the meeting and likely pass at this stage *pending* 2–3 months of retention data — not on
product quality (which is high) but on evidence of pull. The build is not the risk; demand is.

---

## Top 10 Strengths (ranked)

1. **The financial kernel** — canonical formula, SQL/JS predicate mirroring, trigger-maintained counters, nightly
   audit, 518-line test suite with real regression tests. Top-1%.
2. **Security fundamentals** — comprehensive RLS, build-time auth-order gate, constant-time webhook verification,
   sound at-rest note crypto.
3. **Visual design & token system** — premium, coherent, dark-mode-first, accent-themeable.
4. **Operational discipline** — schema-drift CI, audit scripts, documented runbooks in `CLAUDE.md`.
5. **Strict TypeScript migration** completed cleanly with a pragmatic data-layer seam.
6. **UX polish** — undoable deletes, skeleton-first loading, command palette, optimistic+revert mutations.
7. **Lazy-loading & build hygiene** — 40+ split chunks, idle prefetch, no prod sourcemap leak.
8. **Clean domain-hook separation** (`usePatients/useSessions/...`) beneath the coordinator.
9. **Multi-platform reach** — PWA + iOS/Android via Capacitor with native auth bridges, all from one codebase.
10. **Self-aware engineering** — comments that document intentional trade-offs and prior failures.

## Top 25 Weaknesses (ranked by severity)

1. **God-file `App.tsx` (2,551 lines)** — every feature lands here; 39-dep context memo.
2. **7/15 screens untested**, including the money-display screens.
3. **E2E is demo-only smoke** — no real auth or mutation coverage.
4. **`useCardiganData` (1,249 lines) untested** at the orchestration level.
5. **Product breadth far ahead of PMF** — 15 competent features, no validation loop.
6. **70-key untyped context bag** — non-granular re-renders, zero consumer type safety.
7. **`Settings.tsx` (2,344 lines) kitchen sink.**
8. **JS↔SQL predicate parity not tested in CI** — drift only caught by live audit.
9. **2,453 inline styles** bypassing the token system.
10. **Single root ErrorBoundary** — one crash unmounts the app.
11. **Skip-to-content link targets a missing id** (`App.tsx:2034`).
12. **Markdown editor has no ARIA live region** — core surface unusable to AT.
13. **Focus traps applied unevenly** across sheets.
14. **Dialogs missing accessible names** in places.
15. **Resend webhook replayable** (no event-level idempotency).
16. **Rate limiter fails open** under DB stress.
17. **Reschedule/patient-portal mutations not all rate-limited.**
18. **No activation/retention analytics** anywhere.
19. **15-query `Promise.all` hydration** with no granular retry.
20. **Cross-tab auto-extend** relies on a unique index, not coordination.
21. **Untyped Supabase client** despite `gen types` being available.
22. **Dark-mode shadow tokens copy-pasted**, one real focus-ring cross-mode bug.
23. **ARPU ($8) vs. cost surface** (WhatsApp/OCR/Connect/R2) unproven.
24. **Admin email hardcoded in 3 places** incl. client bundle.
25. **Patient medical fields plaintext** while notes are encryptable — inconsistent data-sensitivity model.

## Launch Blockers

For a *real-customer* launch of the **core** product, none of these are hard blockers — the money path is safe.
The ones I would not ship without:
- **B1 — Add `id="main-content"`** and label dialogs; the broken skip link + nameless dialogs are an accessibility
  failure that's a 1-hour fix.
- **B2 — Per-screen ErrorBoundaries** around at least Finances/Home/Notes so a single crash doesn't blank the app.
- **B3 — Rate-limit every state-changing patient-portal endpoint.**
- **B4 — One CI test asserting JS↔SQL predicate parity on a fixture** — this protects the Prime Directive in the
  one place it's currently unguarded in CI.

## Design Debt Report

Token system is excellent; the debt is at the edges: ~2,453 inline `style={{}}` (Settings.tsx ~177), one
cross-mode `.input:focus` literal (`components.css:1018`), copy-pasted dark shadows (`dark.css:59–64`), one-off
spacing outside `--space-*`, ~15–20 hardcoded JSX color fallbacks that won't flip in dark. None block ship; all
compound with scale. Highest leverage: route-based CSS splitting + migrating the top ~150 inline styles to classes.

## Technical Debt Report

God-files (`App.tsx`, `Settings.tsx`, `useCardiganData.ts`), 70-key untyped context, untyped Supabase client,
single ErrorBoundary, demo-only E2E, untested coordinator + screens. The logic is sound; the **module boundaries
and test pyramid** are the debt. Split `App.tsx` into AppShell / ModalOrchestrator / GestureHandler /
ContextAssembler; split context into Data/Action/UI/Config slices; generate Supabase types.

## Scalability Risk Report

- **Code scalability:** class inventory and inline styles grow ~1:1 with screens; design system holds to ~150
  screens then needs splitting tooling. God-files already past sustainable size.
- **Runtime scalability:** non-granular context re-renders; 15-query hydration; unsharded reminder cron. Fine to
  ~100K users, then needs query-level resilience and cron sharding.
- **Org scalability:** the architecture assumes one mind holds it all; onboarding a second engineer into `App.tsx`
  + the 70-key bag is the real near-term risk.

## Security Risk Report

Posture **good**. No criticals after recalibration (the two first-pass "criticals" were a Postgres-RLS
misunderstanding and a correct-pattern false positive). Open medium items: Resend webhook replay, fail-open rate
limiter, unguarded patient-portal mutations. Crypto design is sound. Fix the three mediums; de-dupe the admin email.

## Highest-ROI Improvements (ranked)

1. **CI parity test for the JS↔SQL accounting predicate** — protects the crown jewel; ~1hr.
2. **Accessibility quick-wins** — `id="main-content"`, dialog names, editor live region — ~half a day, large
   correctness/inclusion gain.
3. **Per-screen ErrorBoundaries** — bounds blast radius; ~half a day.
4. **Rate-limit all patient-portal mutations + Resend event dedupe** — closes the real security mediums; ~1 day.
5. **Generate Supabase types** — turns runtime schema drift into compile errors; ~1 day.
6. **Add product analytics (activation, trial→paid)** — converts the biggest investor unknown into data; ~1–2 days.
7. **Split `App.tsx` and slice the context** — unlocks team velocity; ~1 sprint.

## 30-Day Roadmap

- Week 1: parity test + a11y quick-wins + per-screen boundaries (B1–B4).
- Week 2: patient-portal rate limits + Resend dedupe; Supabase type generation.
- Week 3: product analytics on the trial funnel; begin `App.tsx` decomposition (extract ModalOrchestrator + gesture hook).
- Week 4: integration tests for `useCardiganData` orchestration + the untested money screens.

## 90-Day Roadmap

- Slice context into Data/Action/UI/Config; finish `App.tsx`/`Settings.tsx` decomposition.
- Real E2E against a seeded test user covering create-session→balance, record-payment→balance, delete→revert,
  and offline→resync.
- Route-based CSS splitting + inline-style migration.
- Make one product bet based on the analytics; **deprecate or pause** the lowest-engagement of the 15 features.
- Load-test the hydration path and shard the reminder cron.

## Harsh Reality Check

**As a portfolio piece** submitted to Stripe / Linear / Figma / Vercel / Apple / Anthropic: this would **reach
interviews and likely final rounds**, and at the right company **convert to an offer** — but not on the strength of
the UI shell. The thing that gets it there is the **financial-integrity engineering**: the canonical formula, the
SQL/JS predicate mirroring, the trigger-maintained counters, the nightly reconciliation, and the regression tests
that encode *why* prior tests were insufficient. That is a senior/staff-level demonstration of judgment that most
candidates — including strong ones — cannot fake, because it requires having been burned by a financial bug and
having built the guardrail.

What a sharp interviewer would press on, and where a weaker candidate would fail: "Why is `App.tsx` 2,551 lines?
Why a 70-key untyped context? Why are your money-display screens untested while your money-*math* is bulletproof?
Why fifteen features before any retention signal?" The honest answers — velocity, a deliberate migration seam, a
correct prioritization of math over markup, and optionality over focus — are *defensible at the engineering level
and questionable at the product level.* That asymmetry is the whole review in one sentence.

**It is not mediocre. It is excellent in a narrow, important band and merely good everywhere else** — which is a
far better failure mode than the reverse. Fix the test pyramid, bound the blast radius, slice the god-files, and
ship proof of demand, and this crosses from "impressive build" to "fundable, hireable, top-1% product."
