import type { ReactNode } from "react";

// Auth screens: the brand on top and one white card on a plain canvas — the same frame as the sign-in emails. No marketing hero.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-start justify-center bg-canvas px-4 py-12 sm:items-center sm:py-16">
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        <div className="flex items-center gap-2.5 px-1">
          <span aria-hidden className="flex size-7 items-center justify-center rounded-[7px] bg-brand text-sm font-bold text-white">V</span>
          <span className="text-[15px] font-semibold tracking-tight text-text">Vercentlabs</span>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-[0_2px_5px_rgba(50,50,93,0.06),0_1px_1px_rgba(0,0,0,0.04)] sm:p-8">{children}</div>
      </div>
    </div>
  );
}
