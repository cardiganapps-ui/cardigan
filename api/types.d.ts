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
