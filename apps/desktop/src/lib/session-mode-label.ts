import type { SessionPreset } from "./ipc";

const SESSION_MODE_LABELS: Record<SessionPreset, string> = {
  build: "Standard",
  plan: "Plan only",
  explore: "Read only",
};

export function sessionModeLabel(preset: SessionPreset): string {
  return SESSION_MODE_LABELS[preset];
}

export function sessionModeSummary(preset: SessionPreset): string {
  switch (preset) {
    case "plan":
      return "Relay reviews what is there and returns a plan without changing files.";
    case "explore":
      return "Relay reads and searches without changing the project.";
    default:
      return "Relay can inspect and update the project. Sensitive actions may still need approval.";
  }
}

export function sessionModeDefaultNote(preset: SessionPreset): string {
  return `Default: ${sessionModeLabel(preset)}. ${sessionModeSummary(preset)}`;
}
