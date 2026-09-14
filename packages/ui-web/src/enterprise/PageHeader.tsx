import type { ReactNode } from "react";

import { cn } from "../utils/cn";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A caller-supplied breadcrumb trail (e.g. a row of links) -- no dedicated Breadcrumb primitive exists yet, this only reserves the layout slot for one. */
  breadcrumb?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {breadcrumb ? <div className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[length:var(--text-2xl)] font-semibold text-[var(--color-text-primary)]">{title}</h1>
          {description ? <p className="mt-1 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div>
        <h2 className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text-primary)]">{title}</h2>
        {description ? <p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
