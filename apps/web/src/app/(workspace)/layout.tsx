import type { ReactNode } from "react";

// Temporary passthrough. The real app shell (primary sidebar, module nav,
// workspace context, command menu) lands here in a later rebuild phase —
// see docs/ux/UI_REWRITE_TRACKER.md.
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-full bg-canvas">{children}</div>;
}
