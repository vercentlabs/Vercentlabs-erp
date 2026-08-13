import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/utils";
import { Reveal } from "@/components/motion/reveal";

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
        "rounded-(--radius-card) border border-(--color-border-default) bg-(--color-bg-elevated) p-6 shadow-(--shadow-subtle) transition-[box-shadow,transform] duration-(--duration-base) ease-(--ease-standard) hover:-translate-y-0.5 hover:shadow-(--shadow-panel)",
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
export function InformationBand({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  return (
    <div
      className={cx(
        "group flex flex-col gap-4 border-t border-(--color-border-default) px-0 py-7 transition-colors duration-(--duration-base) first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:hover:bg-(--color-bg-subtle) sm:hover:px-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Self-wraps in its own <Reveal group> — items carry data-reveal-item
 * unconditionally, so without a reveal-group ancestor they'd stay stuck at
 * opacity:0 forever (a real bug found in two call sites during the sitewide
 * motion rollout). Making the component self-sufficient beats relying on
 * every caller remembering to wrap it; an outer Reveal/Reveal group at the
 * call site still works fine alongside this, just redundantly.
 */
export function FeatureList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <Reveal group>
    <ul className={cx("flex flex-col gap-3", className)}>
      {items.map((item, index) => (
        <li
          key={index}
          data-reveal-item
          style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}
          className="flex items-start gap-2.5 text-sm text-(--color-text-primary)"
        >
          <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 flex-none text-(--color-text-brand)" aria-hidden="true">
            <path d="M5 10.5 8.5 14 15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
    </Reveal>
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
