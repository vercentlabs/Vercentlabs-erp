import type { ReactNode } from "react";
import { Breadcrumbs } from "../navigation/Breadcrumbs.tsx";
import { cn } from "../utilities/cn.ts";

export interface RecordHeaderField {
  label: string;
  value: ReactNode;
}

export interface RecordHeaderProps {
  className?: string;
  breadcrumbs?: ReactNode;
  /** The record's identifying name/number — kept separate from `status` so
   * layout can't accidentally bury identity behind decoration. */
  title: ReactNode;
  /** A StatusBadge (or similar) — the record's current lifecycle state. */
  status?: ReactNode;
  /** Compact key-value strip (owner, priority, next action, amount…). Keep
   * to what a user needs at a glance — this is not the full record. */
  fields?: RecordHeaderField[];
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
}

/**
 * Header for a Record 360 / record-details page: identity, status, the
 * handful of fields that matter most, and the record's primary action —
 * per the archetype spec's "identity / stage / owner / primary action"
 * pattern (e.g. CRM Lead 360's header).
 */
export function RecordHeader({ className, breadcrumbs, title, status, fields, primaryAction, secondaryActions }: RecordHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {breadcrumbs && <Breadcrumbs>{breadcrumbs}</Breadcrumbs>}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold text-text">{title}</h1>
          {status}
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="flex shrink-0 items-center gap-2">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </div>
      {fields && fields.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
          {fields.map((field, i) => (
            <div key={i} className="flex items-baseline gap-1.5 text-sm">
              <dt className="text-text-muted">{field.label}</dt>
              <dd className="font-medium text-text">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
