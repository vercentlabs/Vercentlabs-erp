import type { ReactNode } from "react";
import { cn } from "../utilities/cn.ts";

export interface SectionHeaderProps {
  className?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/**
 * Just the title/description/actions row, without layout/Section's
 * surrounding <section> + content slot — for when a parent (a Surface, a
 * tab panel) already owns the wrapper and you only need the header row.
 */
export function SectionHeader({ className, title, description, actions }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-section font-semibold text-text">{title}</h3>
        {description && <p className="text-sm text-text-secondary">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
