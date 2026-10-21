import type { ReactNode } from "react";

// Auth screens: on phones, a narrow centered form on a plain canvas. From tablet width up the page splits in half — a quiet brand
// panel on the left (one line, two soft glows drifting very slowly: .auth-glow in globals.css) that stays put while a long form scrolls
// on the right.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full bg-canvas">
      <aside className="relative hidden w-1/2 shrink-0 flex-col justify-between overflow-hidden bg-navigation p-10 text-navigation-text md:sticky md:top-0 md:flex md:h-dvh lg:p-14">
        <div aria-hidden="true" className="auth-grid" />
        <div aria-hidden="true" className="auth-glow auth-glow-a" />
        <div aria-hidden="true" className="auth-glow auth-glow-b" />
        <p className="relative text-sm font-semibold tracking-wide">Vercentlabs ERP</p>
        <h2 className="relative max-w-md text-4xl leading-tight font-semibold tracking-tight lg:text-5xl">
          One ERP.
          <br />
          <span className="text-navigation-muted">Your entire business.</span>
        </h2>
        <p className="relative text-xs text-navigation-muted">{`© ${new Date().getFullYear()} Vercentlabs`}</p>
      </aside>
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-[360px]">{children}</div>
      </div>
    </div>
  );
}
