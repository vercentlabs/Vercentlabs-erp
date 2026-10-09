"use client";

// The create / edit page of a document with lines (an order, a bill, a receipt): CRM's RecordFormPage — header without actions, a banner for
// errors, the form on one surface in FormSections, Cancel / Save at its foot — with an optional side column (totals, the source document)
// that stays in view while the lines scroll.
import type { ReactNode } from "react";
import { PageHeader, Surface, type PageHeaderProps } from "@vercentlabs/design-system";

export function DocumentFormPage({ header, banner, formActions, aside, children }: {
  header: Omit<PageHeaderProps, "primaryAction" | "secondaryActions">; banner?: ReactNode; formActions: ReactNode; aside?: ReactNode; children: ReactNode;
}) {
  const form = (
    <Surface padding="lg" className="min-w-0">
      <div className="flex flex-col gap-4">
        {children}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">{formActions}</div>
      </div>
    </Surface>
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader {...header} />
      {banner}
      {aside ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {form}
          <div className="flex flex-col gap-4 lg:sticky lg:top-4">{aside}</div>
        </div>
      ) : form}
    </div>
  );
}
