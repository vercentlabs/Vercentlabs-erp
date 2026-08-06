import type { ReactNode } from "react";
import { cx } from "@/lib/utils";

type TagTone = "neutral" | "brand" | "success" | "warning" | "error" | "info";

const TAG_CLASSES: Record<TagTone, string> = {
  neutral: "bg-(--color-bg-subtle) text-(--color-text-secondary)",
  brand: "bg-(--color-bg-brand) text-(--color-text-inverse)",
  success: "bg-(--color-state-success-soft) text-(--color-state-success)",
  warning: "bg-(--color-state-warning-soft) text-(--color-state-warning)",
  error: "bg-(--color-state-error-soft) text-(--color-state-error)",
  info: "bg-(--color-state-info-soft) text-(--color-signal-cyan)",
};

/**
 * Rectangular tag — deliberately NOT pill-shaped (Control Surface rejects the
 * product's own pill-badge overuse; see docs/landing-redesign/phase-1/
 * creative-direction.md Part 1).
 */
export function Tag({ children, tone = "neutral", className }: { children: ReactNode; tone?: TagTone; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-(--radius-control) px-2 py-1 text-xs font-medium", TAG_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

/** Same visual treatment as Tag — kept as a distinct export for semantic clarity at call sites. */
export const Badge = Tag;

/** A small color swatch + label used for the module accent legend (never a decorative pill). */
export function ModuleTag({ name, accentColor, className }: { name: string; accentColor: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-(--radius-control) border border-(--color-border-default) px-2 py-1 text-xs font-medium text-(--color-text-primary)", className)}>
      <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: accentColor }} aria-hidden="true" />
      {name}
    </span>
  );
}
