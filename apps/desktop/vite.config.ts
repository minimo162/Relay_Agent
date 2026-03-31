import path from "path";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    __COPILOT_SCRIPT_DEV_PATH__: JSON.stringify(
      path.resolve(__dirname, "scripts/dist/copilot-browser.js")
    )
  }
});
