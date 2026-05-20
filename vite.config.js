import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vercel injects VERCEL_DEPLOYMENT_ID into the build environment when
// Skew Protection is enabled. Bake it into the bundle so the runtime
// fetch interceptor can route every /api/* call back to the deployment
// the user's tab originated from.
const VERCEL_DEPLOYMENT_ID = JSON.stringify(process.env.VERCEL_DEPLOYMENT_ID || '')

// Build-time diagnostic: print whether the Sentry DSNs were available
// at build. The deployed bundle has been missing the DSN for unknown
// reasons even though the env var is set in Vercel; this log lands in
// the Vercel build output where I can grep it. Safe to keep around —
// just prints a single line at build start.
console.log("[vite.config] VITE_SENTRY_DSN present:", !!process.env.VITE_SENTRY_DSN)
console.log("[vite.config] SENTRY_DSN present:", !!process.env.SENTRY_DSN)
console.log("[vite.config] VITE_SUPABASE_URL present:", !!process.env.VITE_SUPABASE_URL)
console.log("[vite.config] env keys starting with VITE_:", Object.keys(process.env).filter(k => k.startsWith("VITE_")).join(","))

export default defineConfig({
  define: {
    __VERCEL_DEPLOYMENT_ID__: VERCEL_DEPLOYMENT_ID,
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
  ],
  build: {
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
