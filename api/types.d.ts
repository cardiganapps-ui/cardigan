// Ambient declarations for untyped deps used by the api/ serverless
// functions. `web-push` ships no types and has no @types package, so
// TS7016 fires on its bare import. Declaring it as an `any`-typed module
// preserves the existing (untyped) runtime behavior without pulling in a
// third-party stub. Mirror the boundary-alias `any` convention used in
// the .ts handlers.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "web-push" {
  const webpush: any;
  export default webpush;
}

// src/utils/accounting.ts (pulled into this project transitively via
// api/widget-data.ts → src/utils/widgetSnapshot.ts) probes
// `import.meta.env` behind a truthiness guard that's designed to
// short-circuit in Node, where the property doesn't exist. The Vite
// client types it via vite/client; give this project the same shape as
// an optional so the guard typechecks without changing runtime behavior.
interface ImportMeta {
  readonly env?: {
    readonly DEV?: boolean;
    readonly [key: string]: unknown;
  };
}
