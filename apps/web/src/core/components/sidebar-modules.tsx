"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

import NavigationSection from "@/core/components/navigation-section";
import { moduleIdForPath } from "@/core/navigation/route-map";
import type { ModuleNavigationGroup } from "@/core/navigation/types";

// Part 11: only one business module expands at a time. NavigationSection's
// native <details> elements are independent by default — nothing stops a
// user from opening several at once. This component owns the single
// "which module is expanded" state and passes it down as a controlled
// prop, so opening one module's section always closes any other.
export default function SidebarModules({
  groups,
  mobile = false,
}: {
  groups: ModuleNavigationGroup[];
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const routeModuleId = moduleIdForPath(pathname);
  const [expanded, setExpanded] = useState<string | null>(routeModuleId);
  // Route-driven state (not label matching): "adjusting state when a prop
  // changes" during render (React's documented pattern — not an effect,
  // avoids the cascading-render setState-in-effect it would otherwise
  // trigger) — whenever the resolved path lands in a different module, that
  // module becomes the expanded one, covering both the initial load and
  // in-app navigation/deep links, while still letting the user manually
  // collapse/expand within the same route.
  const [lastRouteModuleId, setLastRouteModuleId] = useState(routeModuleId);
  if (routeModuleId !== lastRouteModuleId) {
    setLastRouteModuleId(routeModuleId);
    if (routeModuleId) setExpanded(routeModuleId);
  }

  return (
    <>
      {groups.map((group) => (
        <NavigationSection
          icon={group.icon}
          items={group.items}
          key={group.moduleId}
          label={group.label}
          mobile={mobile}
          open={expanded === group.moduleId}
          onOpenChange={(open) => setExpanded(open ? group.moduleId : null)}
        />
      ))}
    </>
  );
}
