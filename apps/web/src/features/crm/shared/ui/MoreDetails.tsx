"use client";

// "More details" on a CRM form: the fields that are not needed to save, folded until opened. It opens by itself when one of them already
// holds a value (editing a record) or has an error, so nothing filled in is ever hidden.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function MoreDetails({ title = "More details", description, hasContent = false, columns = 2, children }: {
  title?: string; description?: ReactNode; hasContent?: boolean; columns?: 1 | 2; children: ReactNode;
}) {
  const [open, setOpen] = useState(hasContent);
  const shown = open || hasContent;
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5" aria-label={title}>
      <button type="button" aria-expanded={shown} onClick={() => setOpen(!shown)}
        className="flex w-fit items-center gap-1.5 text-sm font-semibold text-text outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-brand">
        {shown ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}{title}
      </button>
      {description && !shown && <p className="-mt-2 text-xs text-text-muted">{description}</p>}
      {shown && <div className={columns === 2 ? "grid gap-3 sm:grid-cols-2 sm:gap-4" : "flex flex-col gap-3 sm:gap-4"}>{children}</div>}
    </section>
  );
}

// A small heading that splits More details into groups ("Address", "Owner"); the first has no rule above it.
export function MoreDetailsGroup({ children, hint, first = false }: { children: ReactNode; hint?: string; first?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 sm:col-span-2 ${first ? "" : "border-t border-border pt-4"}`}>
      <p className="text-xs font-medium text-text-secondary">{children}</p>
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}
