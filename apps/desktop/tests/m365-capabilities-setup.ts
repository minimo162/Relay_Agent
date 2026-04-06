import type { FullConfig } from "@playwright/test";
import { loadE2eEnv } from "./e2e/load-e2e-env";

/**
 * CDP capability specs use a live Edge/Chrome instance; no browser is launched here.
 * Loads `.env.e2e` so CDP_* and similar vars are available when the config is evaluated.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  loadE2eEnv();
}
