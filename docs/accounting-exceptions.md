# Accounting figure preservation & exception registry

**Status:** current production patient figures are the source of truth and **must not change**.
This document records how that is guaranteed and isolates the cases that don't fit the
general accounting rule, so the numbers stay fully traceable. Companion data:
[`accounting-exceptions.json`](./accounting-exceptions.json) (point-in-time snapshot).

> Generated/decided 2026-06-22. No patient balance was changed and no session row was
> deleted as part of this. Everything below either preserves the current figures or only
> documents them.

## The rule

A patient's balance is derived live from raw session rows (never from the denormalized
`billed` counter), per `src/utils/accounting.ts`:

```
consumed  = Σ(rate) over sessions that have taken place
              • completed / charged (always)
              • scheduled AND the slot's datetime+1h ≤ now  (auto-complete equivalent)
amountDue = max(0, consumed − paid + opening_balance)
```

## Why the C1 change is KEPT (it preserves the figures — it does not change them)

Session dates are stored yearless (`"D-MMM"`). The year is inferred. Two anchors:

- **`main` (today-anchored):** infers the year closest to *today*. As a session ages past
  ~6 months, the inference flips it into the *future* and it silently **drops out of
  `consumed`** — so a patient's balance **drifts downward over time on its own**.
- **This branch (created_at-anchored):** infers the year closest to the row's `created_at`,
  which is fixed, so a session's count-status never changes after it occurs.

Verified against live production (all 90 patients, 2026-06-22): **the two anchors produce
identical `amountDue` for every patient today** — there are currently no sessions older than
~6 months, so the change is inert *now*. Keeping it is what stops the figures from drifting
later; reverting to `main`'s anchor is what *would* change the information over time.

The predicate is mirrored in four places and must stay in sync:
`src/utils/accounting.ts`, `api/_cardiTools.ts`, `scripts/audit-accounting.mjs`, and the SQL
`session_counts_at` (migration 080, applied to live + snapshot regenerated).

## Exceptions — cases that don't fall under the clean "recurring slot" rule

Some past `scheduled` rows sit on a `(weekday|time)` slot the patient no longer books. These
are detected by `scripts/audit-phantoms.mjs`. They currently **count toward `consumed`** (both
on `main` and this branch), so they are part of the trusted current figures.

**Decision: PRESERVED.** Per the product owner, current figures are correct and must not
change, so these rows are **left exactly as they are** (still counting). They are *not*
deleted and *not* re-classified. This registry isolates + annotates them so any future review
knows which sessions are anomalous and that their inclusion is intentional.

Two tiers (full row-level detail, with session IDs, in the JSON):

| Tier | Meaning | Rows | Σ rate | Patients | Confidence it's a true phantom |
|---|---|---|---|---|---|
| **A** | Different weekday than any current slot | 54 | $38,400 | 16 | Higher — but can still be real "attended then switched slot" history |
| **B** | Same weekday as a current slot, different time | 49 | $29,950 | 10 | Low — almost certainly a real slot-*time* adjustment (e.g. Martes 13:00 → 13:15); **do not treat as phantom** |

Clearest Tier-A clusters (a single current slot + a tidy block on a different weekday):
Victor Hernández, Jordan, Jimena Miguel, Olivia Rivera, Ana O.

If any of these are ever confirmed as true phantoms to remove, do it **per-row with the owner's
confirmation** — deleting a real "attended then switched" session would wrongly *under*-bill.

## If a single session ever needs its figure pinned independent of the rule

The dates support an explicit year suffix (`"D-MMM-YY"`), and the SQL `session_counts_at`
already honors it (overriding inference). To pin a session deterministically: stamp its
`date` with the intended year. **Caveat:** the JS read-path (`normalizeShortDate`) currently
strips the year and `parseShortDate` ignores it, so JS would re-infer — wire JS to honor
`-YY` *before* relying on stamped years, or the JS and SQL predicates would diverge. Until
then, `created_at`-anchoring (above) is the figure-preserving mechanism and needs no per-row
exceptions (zero divergence today).

## Side effect already applied to live (internal only, not therapist-facing)

The denormalized `patient.billed` counter was stale for 52 patients (out of sync with the
derived `consumed`). The migration-080 backfill recomputed it to match the predicate value —
this is **not** a displayed figure (the UI always re-derives `amountDue` from raw sessions),
so no patient balance changed. It only made the internal counter consistent with what the UI
already showed. Revertible if desired.

## How to verify nothing has changed / detect drift

```bash
# Re-derive every balance from raw rows and compare to the denormalized counters.
node --env-file=.env.local scripts/audit-accounting.mjs      # expect 0 billed/paid/sessions drift

# List the anomalous (abandoned-slot) rows for review.
node --env-file=.env.local scripts/audit-phantoms.mjs
```
