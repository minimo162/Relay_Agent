import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
  preprocess: vitePreprocess(),
  kit: {
    alias: {
      "@relay-agent/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url)
      )
    },
    adapter: adapter({
      fallback: "index.html"
    })
  }
};

export default config;
