/** Tailwind-friendly fragments aligned with `--ra-*` / semantic tokens */
export const ui = {
  border: "border-[var(--ra-border)]",
  textPrimary: "text-[var(--ra-text-primary)]",
  textSecondary: "text-[var(--ra-text-secondary)]",
  textMuted: "text-[var(--ra-text-muted)]",
  accent: "text-[var(--ra-accent)]",
  /** Orange gradient marketing CTA — use sparingly; see `.ra-button-accent` / `.ra-fill-accent` */
  fillAccent: "ra-fill-accent",
  surface: "bg-[var(--ra-surface)]",
  surfaceElevated: "bg-[var(--ra-surface-elevated)]",
  /** Card / assistant bubble fill (Surface 400 light / paired dark) */
  surfaceCard: "bg-[var(--ra-surface-card)]",
  hover: "hover:bg-[var(--ra-hover)]",
  mutedText: "text-[var(--ra-text-muted)]",
} as const;
