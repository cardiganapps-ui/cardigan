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
  },
})
