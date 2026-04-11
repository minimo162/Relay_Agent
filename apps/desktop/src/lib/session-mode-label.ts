import type { SessionPreset } from "./ipc";

const SESSION_MODE_LABELS: Record<SessionPreset, string> = {
  build: "Edit files",
  plan: "Read-only plan",
  explore: "Read and search",
};

export function sessionModeLabel(preset: SessionPreset): string {
  return SESSION_MODE_LABELS[preset];
}

export function sessionModeSummary(preset: SessionPreset): string {
  switch (preset) {
    case "plan":
      return "Relay can inspect and plan, but it will not edit files.";
    case "explore":
      return "Relay can inspect files and searches without changing the workspace.";
    default:
      return "Relay can read and edit files. Sensitive actions may still require approval.";
  }
}

export function sessionModeDefaultNote(preset: SessionPreset): string {
  return `Default mode: ${sessionModeLabel(preset)}. ${sessionModeSummary(preset)}`;
}
