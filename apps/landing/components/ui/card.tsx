import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/utils";
import { Reveal } from "@/components/motion/reveal";

export function Card({ children, className, accentColor }: { children: ReactNode; className?: string; accentColor?: string }) {
  return (
    <div
      className={cx(
        "relative border-t border-(--color-border-strong) bg-(--color-bg-elevated) p-6 transition-colors duration-(--duration-base) hover:bg-(--color-bg-selected)",
        className,
      )}
      style={accentColor ? { borderTopColor: accentColor, borderTopWidth: 2 } : undefined}
    >
      {children}
    </div>
  );
}

export function BorderedPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("border-t border-(--color-border-strong) bg-(--color-bg-elevated) p-6 sm:p-8", className)}>{children}</div>;
}

export function InformationBand({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  return (
    <div
      className={cx(
        "group grid grid-cols-1 gap-4 border-t border-(--color-border-default) py-7 transition-colors duration-(--duration-base) first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:hover:bg-(--color-bg-elevated)",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function FeatureList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <Reveal group>
      <ul className={cx("flex flex-col border-t border-(--color-border-default)", className)}>
        {items.map((item, index) => (
          <li
            key={index}
            data-reveal-item
            style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}
            className="grid grid-cols-[2rem_1fr] gap-3 border-b border-(--color-border-default) py-3.5 text-sm text-(--color-text-primary)"
          >
            <span className="vl-index text-(--color-text-brand)" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}

export function Checklist({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cx("flex flex-col border-t border-(--color-border-default)", className)}>
      {items.map((item, index) => (
        <li key={index} className="grid grid-cols-[1.5rem_1fr] gap-3 border-b border-(--color-border-default) py-3 text-sm leading-relaxed text-(--color-text-secondary)">
          <span className="text-(--color-text-brand)" aria-hidden="true">↳</span>
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

export function Metric({ label, value, className }: MetricProps) {
  return (
    <div className={cx("flex min-w-[108px] flex-col gap-2 border-l border-(--color-border-default) pl-4", className)}>
      <span className="tabular-data text-3xl font-semibold leading-none tracking-[-0.055em] text-(--color-text-primary)">{value}</span>
      <span className="text-[0.65rem] font-bold uppercase tracking-[0.13em] text-(--color-text-muted)">{label}</span>
    </div>
  );
}
