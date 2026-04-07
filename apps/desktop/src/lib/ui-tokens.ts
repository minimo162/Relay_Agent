/** Tailwind-friendly fragments aligned with `--ra-*` / semantic tokens */
export const ui = {
  border: "border-[var(--ra-border)]",
  textPrimary: "text-[var(--ra-text-primary)]",
  textSecondary: "text-[var(--ra-text-secondary)]",
  textMuted: "text-[var(--ra-text-muted)]",
  accent: "text-[var(--ra-accent)]",
  surface: "bg-[var(--ra-surface)]",
  surfaceElevated: "bg-[var(--ra-surface-elevated)]",
  hover: "hover:bg-[var(--ra-hover)]",
  mutedText: "text-[var(--ra-text-muted)]",
} as const;
