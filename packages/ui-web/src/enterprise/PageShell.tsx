import type { HTMLAttributes } from "react";

import { cn } from "../utils/cn";

// The one page-level layout wrapper every module screen mounts into
// (max-width, gutters, vertical rhythm) so individual pages stop each
// reinventing their own container -- see
// docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md.
export function PageShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6", className)} {...props} />;
}
