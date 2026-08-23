"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import SemanticNavigationIcon from "@/core/components/semantic-navigation-icon";
import { moduleIdForPath } from "@/core/navigation/route-map";
import type { QuickCreateAction } from "@/core/quick-create/actions";
import { useOutsideDismiss } from "@/shared/use-outside-dismiss";

// The topbar's "+ Create" control (Part 10). `actions` arrives already
// server-filtered by module access + permission (resolveQuickCreate() in
// apps/web/src/app/(app)/layout.tsx) — this component only reorders what's
// already safe to show, ranking the current page's module first
// (Part 12); it never adds or re-permits an action client-side.
export default function QuickCreateButton({ actions }: { actions: QuickCreateAction[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(containerRef, open, () => setOpen(false));

  if (actions.length === 0) return null;

  const currentModuleId = moduleIdForPath(pathname);
  const ranked = currentModuleId
    ? [...actions.filter((a) => a.moduleId === currentModuleId), ...actions.filter((a) => a.moduleId !== currentModuleId)]
    : actions;

  return (
    <div className="topbar-menu" ref={containerRef}>
      <button
        type="button"
        className="quick-create-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Create"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">+</span>
        <span className="quick-create-label">Create</span>
      </button>
      {open ? (
        <div className="topbar-popover" role="menu" aria-label="Quick create">
          {ranked.map((action) => (
            <Link
              key={action.id}
              className="topbar-popover-item"
              href={action.href}
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <SemanticNavigationIcon href={action.href} fallback={action.icon} size={16} />
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
