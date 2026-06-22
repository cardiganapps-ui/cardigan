/* ── Minimal supabase-js client mock for hook tests ──
   The supabase-js client exposes chainable query builders; we mirror
   only the surface that our hooks touch. Each call is recorded in
   `calls` for inspection. Responses are pulled from a per-table queue;
   if the queue is empty the builder resolves with `{ data: null, error: null }`.

   Typical usage:

     const mock = makeSupabaseMock();
     mock.enqueue("payments", { data: { id: "real-1", ... }, error: null });
     mock.enqueue("patients", { error: null });

     // Inject into module via vi.mock:
     // vi.mock("../../supabaseClient", () => ({ supabase: mock.supabase }));

   The mock is intentionally loose — we don't simulate table schemas or
   enforce FK constraints. The hooks under test pass shape-correct
   payloads through; we just need to observe what they asked for and
   hand back the canned response. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

type State = {
  calls: Row[];
  queues: Record<string, Row[]>;
  fallback: Record<string, Row>;
};

function makeBuilder(table: string, state: State): Row {
  const ops: Row[] = [];
  const builder: Row = {
    insert(row: Row) { ops.push({ op: "insert", row }); return builder; },
    update(row: Row) { ops.push({ op: "update", row }); return builder; },
    upsert(row: Row, opts: Row) { ops.push({ op: "upsert", row, opts }); return builder; },
    delete() { ops.push({ op: "delete" }); return builder; },
    select(cols: Row) { ops.push({ op: "select", cols }); return builder; },
    single() { ops.push({ op: "single" }); return builder; },
    maybeSingle() { ops.push({ op: "maybeSingle" }); return builder; },
    eq(col: Row, val: Row) { ops.push({ op: "eq", col, val }); return builder; },
    neq(col: Row, val: Row) { ops.push({ op: "neq", col, val }); return builder; },
    in(col: Row, vals: Row) { ops.push({ op: "in", col, vals }); return builder; },
    gte(col: Row, val: Row) { ops.push({ op: "gte", col, val }); return builder; },
    is(col: Row, val: Row) { ops.push({ op: "is", col, val }); return builder; },
    not(col: Row, op: Row, val: Row) { ops.push({ op: "not", col, matcher: op, val }); return builder; },
    order(col: Row, opts: Row) { ops.push({ op: "order", col, opts }); return builder; },
    limit(n: Row) { ops.push({ op: "limit", n }); return builder; },
    then(resolve: Row, reject: Row) {
      state.calls.push({ table, ops: [...ops] });
      const q = state.queues[table] || [];
      let resp;
      if (q.length > 0) {
        resp = q.shift();
      } else if (state.fallback[table]) {
        resp = state.fallback[table];
      } else {
        resp = { data: null, error: null };
      }
      // Allow hooks to inspect previously-made calls mid-test by awaiting
      // a microtask between when `.then` is attached and when the resolver
      // runs.
      const result = typeof resp === "function" ? resp({ table, ops }) : resp;
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

export function makeSupabaseMock() {
  const state: State = {
    calls: [],
    queues: {},
    fallback: {},
  };
  return {
    supabase: {
      from(table: string) { return makeBuilder(table, state); },
      auth: {
        getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
        getUser: async () => ({ data: { user: null }, error: null }),
      },
      rpc: async (fn: string, args: Row) => {
        state.calls.push({ rpc: fn, args });
        // RPC responses queue under "rpc:<fn>" so a test can enqueue
        // different responses for different RPC functions. Fallback
        // to "rpc" (any function), then to `{ data: null, error: null }`.
        const q = state.queues[`rpc:${fn}`] || state.queues.rpc;
        if (q && q.length > 0) {
          const resp = q.shift();
          return typeof resp === "function" ? resp({ rpc: fn, args }) : resp;
        }
        return { data: null, error: null };
      },
    },
    /** Queue a response for the next awaited call against `table`. */
    enqueue(table: string, response: Row) {
      (state.queues[table] = state.queues[table] || []).push(response);
    },
    /** Set a default response when the queue for `table` is empty. */
    setFallback(table: string, response: Row) {
      state.fallback[table] = response;
    },
    calls: state.calls,
    callsFor(table: string) { return state.calls.filter((c: Row) => c.table === table); },
    reset() {
      state.calls.length = 0;
      state.queues = {};
      state.fallback = {};
    },
  };
}

/** React-style state setter that captures the current value in a closure. */
export function makeStateHolder(initial: Row) {
  let value = initial;
  const setter: Row = (v: Row) => { value = typeof v === "function" ? v(value) : v; };
  setter.get = () => value;
  return setter;
}
