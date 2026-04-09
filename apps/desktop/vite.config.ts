import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Pin ESM paths so Vite resolves dompurify/marked reliably (pnpm + Windows). */
function tryResolve(spec: string): string | undefined {
  try {
    return require.resolve(spec);
  } catch {
    return undefined;
  }
}

function localNodeModule(...segments: string[]): string | undefined {
  const p = path.join(__dirname, "node_modules", ...segments);
  return fs.existsSync(p) ? p : undefined;
}

const dompurifyEsm =
  tryResolve("dompurify/dist/purify.es.mjs") ??
  localNodeModule("dompurify", "dist", "purify.es.mjs");
const markedEsm =
  tryResolve("marked/lib/marked.esm.js") ??
  localNodeModule("marked", "lib", "marked.esm.js");

const isE2E = process.env.RELAY_E2E === "1";

export default defineConfig({
  plugins: [
    tailwindcss(),
    solidPlugin(),
  ],
  define: {
    "import.meta.env.RELAY_E2E": JSON.stringify(isE2E),
  },
  optimizeDeps: {
    include: [
      ...(dompurifyEsm ? (["dompurify"] as const) : []),
      ...(markedEsm ? (["marked"] as const) : []),
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      ...(dompurifyEsm ? { dompurify: dompurifyEsm } : {}),
      ...(markedEsm ? { marked: markedEsm } : {}),
      ...(isE2E
        ? {
            "@tauri-apps/api/core": path.resolve(__dirname, "tests/tauri-mock-core.ts"),
            "@tauri-apps/api/event": path.resolve(__dirname, "tests/tauri-mock-event.ts"),
            "@tauri-apps/plugin-dialog": path.resolve(__dirname, "tests/tauri-mock-dialog.ts"),
          }
        : {}),
    },
  },
  server: {
    port: 1421,
    host: "0.0.0.0",
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
  },
  build: {
    target: "esnext",
  },
});
