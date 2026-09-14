import type { ReactNode } from "react";

import { cn } from "../utils/cn";

export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "positive" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-[120px] flex-col gap-0.5 rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] px-3 py-2",
        className,
      )}
    >
      <span className="text-[length:var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</span>
      <span
        className={cn(
          "text-[length:var(--text-lg)] font-semibold",
          tone === "positive" && "text-[var(--color-state-success)]",
          tone === "danger" && "text-[var(--color-state-danger)]",
          tone === "neutral" && "text-[var(--color-text-primary)]",
        )}
      >
        {value}
      </span>
      {hint ? <span className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">{hint}</span> : null}
    </div>
  );
}
