import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vercel injects VERCEL_DEPLOYMENT_ID into the build environment when
// Skew Protection is enabled. Bake it into the bundle so the runtime
// fetch interceptor can route every /api/* call back to the deployment
// the user's tab originated from.
const VERCEL_DEPLOYMENT_ID = JSON.stringify(process.env.VERCEL_DEPLOYMENT_ID || '')

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
