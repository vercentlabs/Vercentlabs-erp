import type { ReactNode } from "react";

// Visually restrained — no marketing hero, per Prompt 2 Phase 4. Auth
// screens are a narrow centered card on a plain canvas.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-[360px]">{children}</div>
    </div>
  );
}
