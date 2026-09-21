import type { ReactNode } from "react";

// The customer-facing frame: Vercentlabs identity, a calm card, and room to breathe on a phone.
export function BookingShell({ host, title, meta, children }: { host?: string | null; title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-brand text-base font-bold text-text-inverse">
          V
        </span>
        <span className="text-sm font-semibold tracking-wide text-text">Vercentlabs</span>
      </header>
      <main className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-1 border-b border-border bg-brand-soft px-5 py-5 sm:px-8">
          {host && <p className="text-xs font-medium uppercase tracking-wide text-brand-active">{host}</p>}
          <h1 className="text-xl font-semibold text-text sm:text-2xl">{title}</h1>
          {meta && <div className="text-sm text-text-secondary">{meta}</div>}
        </div>
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-8">{children}</div>
      </main>
      <footer className="text-center text-xs text-text-muted">Scheduling by Vercentlabs</footer>
    </div>
  );
}
