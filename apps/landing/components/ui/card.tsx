import type { ReactNode } from "react";
import { cx } from "@/lib/utils";

/**
 * Control Surface deliberately avoids "excessive card grids" (docs/landing-redesign/
 * phase-1/creative-direction.md). Card exists for genuinely discrete, browsable items
 * (a module in the module index, a workflow step) — not as a default section wrapper.
 * Prefer a plain Section + Stack for ordinary content.
 */
export function Card({ children, className, accentColor }: { children: ReactNode; className?: string; accentColor?: string }) {
  return (
    <div
      className={cx(
        "rounded-(--radius-card) border border-(--color-border-default) bg-(--color-bg-elevated) p-6 shadow-(--shadow-subtle) transition-shadow hover:shadow-(--shadow-panel)",
        className,
      )}
      style={accentColor ? { borderTopColor: accentColor, borderTopWidth: 3 } : undefined}
    >
      {children}
    </div>
  );
}

/** A bordered panel with no shadow — for structural grouping, not "card" affordance. */
export function BorderedPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-(--radius-panel) border border-(--color-border-default) p-6 sm:p-8", className)}>{children}</div>
  );
}

/** Full-width horizontal band — the Control Surface alternative to a card grid. */
export function InformationBand({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "flex flex-col gap-4 border-t border-(--color-border-default) py-6 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FeatureList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cx("flex flex-col gap-3", className)}>
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2.5 text-sm text-(--color-text-primary)">
          <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 flex-none text-(--color-text-brand)" aria-hidden="true">
            <path d="M5 10.5 8.5 14 15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Checklist({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cx("flex flex-col gap-2", className)}>
      {items.map((item, index) => (
        <li key={index} className="flex items-center gap-2 text-sm text-(--color-text-secondary)">
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-(--color-text-brand)" aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
}

interface MetricProps {
  label: string;
  value: ReactNode;
  className?: string;
}

/** A real, evidence-backed number only — never a fabricated statistic (Evidence and Honesty Rules). */
export function Metric({ label, value, className }: MetricProps) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <span className="tabular-data text-2xl font-semibold tracking-[-0.02em] text-(--color-text-primary)">{value}</span>
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-(--color-text-muted)">{label}</span>
    </div>
  );
}
