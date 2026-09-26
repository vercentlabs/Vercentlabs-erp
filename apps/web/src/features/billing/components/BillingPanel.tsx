"use client";

import type { ReactNode } from "react";

export function BillingPanel({ title, description, children, testId }: { title: string; description?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label={title} data-testid={testId}>
      <div>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const TONES = {
  danger: "border-danger-emphasis/30 bg-danger-soft text-danger",
  warning: "border-warning-emphasis/30 bg-warning-soft text-warning",
  success: "border-success-emphasis/30 bg-success-soft text-success",
  info: "border-info-emphasis/30 bg-info-soft text-info",
};

export function BillingNotice({ tone, children, testId }: { tone: keyof typeof TONES; children: ReactNode; testId?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} data-testid={testId} className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm ${TONES[tone]}`}>
      {children}
    </div>
  );
}
