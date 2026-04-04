import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const isE2E = process.env.RELAY_E2E === "1";

export default defineConfig({
  plugins: [
    tailwindcss(),
    solidPlugin(),
  ],
  define: {
    "import.meta.env.RELAY_E2E": JSON.stringify(isE2E),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      ...(isE2E
        ? {
            "@tauri-apps/api/core": path.resolve(__dirname, "tests/tauri-mock-core.ts"),
            "@tauri-apps/api/event": path.resolve(__dirname, "tests/tauri-mock-event.ts"),
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
