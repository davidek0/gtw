// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import { loadEnv } from "vite";

const backendEnv = loadEnv(
  process.env.NODE_ENV === "production" ? "production" : "development",
  path.resolve("..", "backend"),
  "",
);

// These values stay in the Vite/TanStack server process. They intentionally
// have no VITE_ prefix, so Vite never exposes them to the browser bundle.
for (const name of [
  "ADMIN_API_TOKEN",
  "BACKEND_URL",
  "GARMIN_SUBJECT_ID",
] as const) {
  if (backendEnv[name]) process.env[name] = backendEnv[name];
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // The demo is edited while Vite is running for long periods. Rebuild
    // prebundled TanStack modules at startup so stale hashed imports cannot
    // leave the SSR HTML visible but prevent React from hydrating.
    optimizeDeps: {
      force: true,
    },
  },
});
