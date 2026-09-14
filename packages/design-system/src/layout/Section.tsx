import type { ReactNode } from "react";
import { cn } from "../utilities/cn.ts";

export interface SectionProps {
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  /** Rendered alongside the title (a "Show all" link, an edit toggle). */
  actions?: ReactNode;
  children: ReactNode;
}

/** A titled content section within a page or record — the level below
 * PageHeader/RecordHeader (enterprise/). Not a Surface; compose the two
 * when a section also needs a bordered/panel treatment. */
export function Section({ className, title, description, actions, children }: SectionProps) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            {title && <h2 className="text-section font-semibold text-text">{title}</h2>}
            {description && <p className="text-sm text-text-secondary">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
