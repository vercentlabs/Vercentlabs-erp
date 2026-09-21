import type { ReactNode } from "react";
import { Breadcrumbs } from "../navigation/Breadcrumbs.tsx";
import { cn } from "../utilities/cn.ts";

export interface PageHeaderProps {
  className?: string;
  breadcrumbs?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** The one visually-dominant primary action for this page, per the
   * "one clear primary action" principle — don't pass more than one
   * primary-variant Button here. */
  primaryAction?: ReactNode;
  /** Secondary actions (outline/ghost buttons, an overflow menu). */
  secondaryActions?: ReactNode;
  /** A page has one h1. When several list sections share a page, the sections use level 2. */
  headingLevel?: 1 | 2;
}

/** Header for a module home or list page — not for a specific record (use
 * RecordHeader, which carries status/owner/lineage a list page doesn't). */
export function PageHeader({ className, breadcrumbs, title, description, primaryAction, secondaryActions, headingLevel = 1 }: PageHeaderProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {breadcrumbs && <Breadcrumbs>{breadcrumbs}</Breadcrumbs>}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Heading className={headingLevel === 1 ? "text-2xl font-semibold text-text" : "text-xl font-semibold text-text"}>{title}</Heading>
          {description && <p className="text-sm text-text-secondary">{description}</p>}
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="flex shrink-0 items-center gap-2">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}
