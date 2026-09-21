import type { ReactNode } from "react";

// A titled group of related fields inside a long form.
export function FormSection({ title, description, children, columns = 2 }: { title: string; description?: string; children: ReactNode; columns?: 1 | 2 }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0" aria-label={title}>
      <div>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      <div className={`grid grid-cols-1 gap-4 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>{children}</div>
    </section>
  );
}
