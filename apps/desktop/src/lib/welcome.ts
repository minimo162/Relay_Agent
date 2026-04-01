import { browser } from "$app/environment";

const KEY = "relay_agent_welcome_seen";

export function hasSeenWelcome(): boolean {
  if (!browser) {
    return true;
  }

  return window.localStorage.getItem(KEY) === "1";
}

export function markWelcomeSeen(): void {
  if (!browser) {
    return;
  }

  window.localStorage.setItem(KEY, "1");
}
