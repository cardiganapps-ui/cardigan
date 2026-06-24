/* ── Domain row types — the data layer's typed boundary (WS-4) ─────────
   The hooks fetch loosely-typed rows from the Supabase client and thread
   them through the coordinator (useCardiganData) into the domain factories.
   These aliases are that boundary's concrete shape: each is the generated
   `Tables<"x">` row PLUS the small set of in-memory deltas the read path
   adds (the camelCase colorIdx alias from mapRows, optimistic-insert
   markers, the display-only auto-complete flag).

   Built on the generated schema types (src/types/db.ts → src/types/supabase.ts),
   so a migration that renames/drops a column turns into a compile error
   here and at every consumer — the same load-bearing-types contract that
   financialColumns.ts established for the money columns.

   Regenerate the source types after a migration:
     node --env-file=.env.local scripts/gen-types.mjs */

import type { Tables } from "./db";

/** mapRows() aliases the snake_case `color_idx` into a camelCase `colorIdx`
    on every patients/sessions/payments/groups row it normalizes. */
type WithColorIdx = { colorIdx?: number | null };

/** Marks a row inserted optimistically in-memory before the server confirms
    it (cleared once the real row replaces it). Never present on a DB read. */
type Optimistic = { _optimistic?: boolean };

/** Columns the DB assigns/maintains on write. They're present on a row read
    back from the server, but ABSENT on an optimistic temp row that the hooks
    insert into client state before the round-trip reconciles it. Modeled
    optional so those temp-row literals typecheck without an escape hatch,
    while server reads still carry them. `color_idx` joins the set because an
    optimistic row carries the camelCase `colorIdx` delta in its place. */
type ServerManaged = "created_at" | "updated_at" | "version" | "color_idx";
type StateRow<T> =
  Omit<T, ServerManaged & keyof T> & Partial<Pick<T, ServerManaged & keyof T>>;

// ── Core rows ────────────────────────────────────────────────────────
// `patients.billed/paid/sessions` are nullable in the schema but maintained
// by DB triggers (migrations 068/069) and never observed null by the app, so
// they're narrowed to non-null by intersection — `(number | null) & number`
// resolves to `number`, sparing every read site a `?? 0`.
export type PatientRow = StateRow<Tables<"patients">> & WithColorIdx & {
  paid: number;
  billed: number;
  sessions: number;
};

export type SessionRow = StateRow<Tables<"sessions">> & WithColorIdx & Optimistic & {
  /** Set by the enrichedSessions pass when a past `scheduled` row is shown
      as `completed` (display-only — never persisted). */
  _autoCompleted?: boolean;
};

export type PaymentRow = StateRow<Tables<"payments">> & WithColorIdx & Optimistic;

export type NoteRow = StateRow<Tables<"notes">> & Optimistic;

export type DocumentRow = StateRow<Tables<"documents">> & Optimistic;

export type ExpenseRow = StateRow<Tables<"expenses">> & Optimistic;

export type RecurringExpenseRow = StateRow<Tables<"recurring_expenses">> & Optimistic;

export type MeasurementRow = StateRow<Tables<"measurements">>;

export type GroupRow = StateRow<Tables<"groups">> & WithColorIdx;

export type GroupMemberRow = StateRow<Tables<"group_members">> & Optimistic;

export type NotificationRow = Tables<"notifications">;

export type RescheduleRequestRow = Tables<"session_reschedule_requests">;

export type NoteAttachmentRow = Tables<"note_attachments">;

/** note_tags rows carry a decrypted `label` derived from `label_ciphertext`
    on read (or a pass-through of the ciphertext when crypto is locked/off). */
export type TagRow = Tables<"note_tags"> & { label?: string };

export type TagLinkRow = Tables<"note_tag_links">;

// ── Enriched rows (post-accounting / post-display) ───────────────────
/** A patient after applyConsumedToPatients folds in the canonical balance.
    The `{ amountDue, credit }` delta mirrors that helper's return exactly. */
export type EnrichedPatient = PatientRow & { amountDue: number; credit: number };

/** A session after the display-only auto-complete pass (enrichedSessions).
    Structurally a SessionRow; the alias names the intent at consumer sites. */
export type EnrichedSession = SessionRow;
