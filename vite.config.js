import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Vercel injects VERCEL_DEPLOYMENT_ID into the build environment when
// Skew Protection is enabled. Bake it into the bundle so the runtime
// fetch interceptor can route every /api/* call back to the deployment
// the user's tab originated from.
const VERCEL_DEPLOYMENT_ID = JSON.stringify(process.env.VERCEL_DEPLOYMENT_ID || '')

// Sentry sourcemap upload — only active when SENTRY_AUTH_TOKEN +
// SENTRY_ORG + SENTRY_PROJECT are all present in the build env.
// Without them, the plugin disables itself and the build still
// emits sourcemaps locally (which we delete right after, so they
// never ship to users). Same env vars work for the Vercel build,
// the Android cap:bundle build, and the iOS GitHub Actions build.
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN
const SENTRY_ORG        = process.env.SENTRY_ORG
const SENTRY_PROJECT    = process.env.SENTRY_PROJECT
const SENTRY_ENABLED    = Boolean(SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT)

// Release identifier — matches the value passed to Sentry.init() in
// src/lib/sentry.js so events from this bundle resolve their
// sourcemaps to the right release. Prefer the deployment id (stable
// across the same Vercel build); fall back to a per-build timestamp
// so local + CI builds still get a deterministic, non-empty release.
const SENTRY_RELEASE = process.env.VERCEL_DEPLOYMENT_ID
  || process.env.GITHUB_SHA
  || `cardigan@${Date.now()}`

export default defineConfig({
  define: {
    __VERCEL_DEPLOYMENT_ID__: VERCEL_DEPLOYMENT_ID,
    __SENTRY_RELEASE__: JSON.stringify(SENTRY_RELEASE),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // we handle registration in main.jsx
      manifest: false, // we use our own public/manifest.json
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // heic2any is a 1.3MB lazy chunk only used when a user uploads
        // an iPhone-default HEIC photo. Most therapists never trigger
        // it, so excluding it from precache keeps the PWA install
        // payload lean. The dynamic import still works at runtime —
        // the browser just fetches it on first HEIC upload instead
        // of paying the cost for every user upfront.
        globIgnores: ['**/heic2any-*.js'],
      },
    }),
    // Sentry sourcemap upload. Plugin order matters — must come AFTER
    // the build emits sourcemaps. The plugin uploads them to Sentry
    // and then deletes the *.map files from dist/ so they never ship
    // (sourcemaps in production = source code leak). Disabled when the
    // required env vars aren't set so local + secret-less CI builds
    // still succeed.
    SENTRY_ENABLED && sentryVitePlugin({
      org: SENTRY_ORG,
      project: SENTRY_PROJECT,
      authToken: SENTRY_AUTH_TOKEN,
      release: { name: SENTRY_RELEASE },
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
      // Telemetry on by default; opt out — Sentry doesn't need to
      // know about every Cardigan build.
      telemetry: false,
    }),
  ].filter(Boolean),
  build: {
    // Emit sourcemaps only when the Sentry plugin is wired up — it
    // uploads them and immediately deletes the .map files from dist/
    // (see sourcemaps.filesToDeleteAfterUpload above), so nothing
    // reaches the CDN. Without the plugin we'd be shipping a fully-
    // walkable source tree under /assets/*.map, which is a source
    // leak we don't want even for an open-source-able app like
    // Cardigan. Local builds without the token = no maps = no leak.
    sourcemap: SENTRY_ENABLED,
    cssMinify: true,
    rollupOptions: {
      output: {
        // Manual chunking to keep the main bundle under the 500 kB
        // soft warning. Without this, Vite emits a single
        // ~970 kB index-*.js that re-downloads from scratch every
        // time we redeploy. Splitting heavy deps means cached
        // vendor/supabase chunks survive across deploys, and the
        // app shell ships smaller on cold starts.
        manualChunks: {
          react:    ["react", "react-dom"],
          supabase: ["@supabase/supabase-js"],
          sentry:   ["@sentry/react"],
          // AWS S3 SDK is only used by the document viewer + uploader.
          // Splitting it lets users who never open a document avoid
          // pulling it. Note: Vite bundles whatever the rollup graph
          // reaches anyway, so this just isolates the chunk — it's
          // still loaded the first time the import hits.
          "aws-s3":  ["@aws-sdk/client-s3"],
        },
      },
    },
    // Quiet the legitimate-but-noisy 500 kB warning since the chunks
    // we ship are deliberately split now and well-cached separately.
    chunkSizeWarningLimit: 600,
  },
})
