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
  /** DESIGN.md §3 type utilities (see `index.css`) */
  typeBodySans: "ra-type-body-sans",
  typeBodySerifSm: "ra-type-body-serif-sm",
  typeMonoSmall: "ra-type-mono-small",
  typeMonoBody: "ra-type-mono-body",
  typeTitleSm: "ra-type-title-sm",
  typeCaption: "ra-type-caption",
  typeSystemCaption: "ra-type-system-caption",
  typeSystemMicro: "ra-type-system-micro",
  typeButtonCaption: "ra-type-button-caption",
  /** Radii — use with `rounded-[…]` */
  radius: "rounded-[var(--ra-radius)]",
  radiusFeatured: "rounded-[var(--ra-radius-featured)]",
  radiusCompact: "rounded-[var(--ra-radius-compact)]",
  radiusPill: "rounded-[var(--ra-radius-pill)]",
} as const;
