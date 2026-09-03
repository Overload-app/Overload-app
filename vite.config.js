import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // We already ship our own public/manifest.json + apple meta tags in
      // index.html, so let the plugin use those as-is rather than generating
      // a second, possibly-conflicting one.
      manifest: false,
      includeAssets: ["icon-192.png", "icon-512.png"],
      workbox: {
        // Precache the built app shell (JS/CSS/HTML) so the app can open
        // with zero signal — this is what actually makes "offline at the
        // gym" possible, on top of the manifest-based home-screen install.
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        navigateFallback: "/index.html",
        // Without these, a newly deployed version sits "waiting" until every
        // open tab/instance of the app is fully closed — which on a phone
        // (installed to the home screen) can mean a fix never visibly
        // arrives. This makes a new service worker take over immediately.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Supabase reads: try the network first (fresh data when
            // online), but fall back to the last successful response when
            // offline instead of failing outright.
            urlPattern: ({ url }) => url.hostname.endsWith(".supabase.co"),
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Lets `npm run dev` also register a service worker, so offline
        // behavior can be tested without doing a full production build.
        enabled: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Splits third-party code (stable, rarely changes between deploys)
        // away from app code (changes on every deploy) into its own chunk.
        // On a repeat visit — the normal case for a workout app people
        // open every session — the browser can reuse the cached vendor
        // chunk across app updates instead of re-downloading it every
        // single time alongside the app code that actually changed.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Split ONLY recharts (and its own dependency tree) into its own
          // chunk — it's large and used exclusively by the Progress tab.
          // Everything else (react, supabase-js, lucide-react) shares one
          // vendor chunk; splitting react out further caused a circular
          // chunk dependency (recharts' own react-smooth/react-transition-
          // group sub-dependencies also match "react"), not worth the
          // added complexity for what's already the bulk of the win.
          if (id.includes("recharts") || id.includes("d3-") || id.includes("react-smooth") || id.includes("react-transition-group")) {
            return "vendor-charts";
          }
          return "vendor";
        },
      },
    },
  },
  test: {
    // Plain node by default (fast, no DOM) — component test files opt into
    // jsdom individually via a `// @vitest-environment jsdom` comment.
    environment: "node",
    // Needed for React Testing Library's automatic cleanup between tests:
    // it registers itself onto a global afterEach, which only exists when
    // this is on. App.test.js's explicit `import { ... } from "vitest"`
    // keeps working unaffected either way.
    globals: true,
  },
});
