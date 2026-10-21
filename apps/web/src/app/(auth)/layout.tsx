import type { ReactNode } from "react";

// Auth screens: the brand on top and the form. On a phone the form fills a plain white page; from tablet width it sits in one white card
// on the canvas — the same frame as the sign-in emails. No marketing hero.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full justify-center bg-surface px-5 pt-8 pb-10 sm:items-center sm:bg-canvas sm:px-4 sm:py-16">
      <div className="flex w-full max-w-[400px] flex-col gap-8 sm:gap-6">
        <div className="flex items-center gap-2.5 sm:px-1">
          <span aria-hidden className="flex size-7 items-center justify-center rounded-[7px] bg-brand text-sm font-bold text-white">V</span>
          <span className="text-[15px] font-semibold tracking-tight text-text">Vercentlabs</span>
        </div>
        <div className="sm:rounded-xl sm:border sm:border-border sm:bg-surface sm:p-8 sm:shadow-[0_2px_5px_rgba(50,50,93,0.06),0_1px_1px_rgba(0,0,0,0.04)]">{children}</div>
      </div>
    </div>
  );
}
