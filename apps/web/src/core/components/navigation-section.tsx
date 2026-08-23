"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";

import AppIcon, { type AppIconName } from "@/shared/components/app-icon";
import NavigationLink from "@/core/components/navigation-link";
import { matchesPath, type MatchablePath } from "@/core/navigation/match-path";

export type NavigationSectionItem = MatchablePath & {
  label: string;
  icon: AppIconName;
  badge?: number;
  group?: string;
};

export default function NavigationSection({
  label,
  icon,
  items,
  mobile = false,
  open: controlledOpen,
  onOpenChange,
}: {
  label: string;
  icon: AppIconName;
  items: NavigationSectionItem[];
  mobile?: boolean;
  /** When provided (module sidebar sections), this section's open state is externally coordinated — see sidebar-modules.tsx (Part 11: only one module expands at a time). When omitted (e.g. Workspace settings), the section falls back to its own route-driven auto-open, unmanaged by any sibling. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const active = items.some((item) => matchesPath(pathname, item));
  const open = controlledOpen ?? active;

  return (
    <details
      className={`nav-section${active ? " active" : ""}${mobile ? " mobile" : ""}`}
      open={open}
      onToggle={
        onOpenChange
          ? (event) => onOpenChange((event.target as HTMLDetailsElement).open)
          : undefined
      }
    >
      <summary aria-expanded={open}>
        <span className="nav-section-icon" aria-hidden="true">
          <AppIcon name={icon} size={18} />
        </span>
        <span className="nav-section-label">{label}</span>
        <AppIcon
          className="nav-section-chevron"
          name="chevron-down"
          size={15}
        />
      </summary>
      <div className="nav-section-items">
        {items.map((item, index) => {
          const previousGroup = items[index - 1]?.group;
          const showGroup = Boolean(item.group && item.group !== previousGroup);
          return (
            <Fragment key={item.href}>
              {showGroup ? (
                <p className="nav-subgroup-label">{item.group}</p>
              ) : null}
              <NavigationLink
                activePrefixes={item.activePrefixes}
                badge={item.badge}
                exact={item.exact}
                href={item.href}
                icon={item.icon}
                label={item.label}
                mobile={mobile}
                nested
              />
            </Fragment>
          );
        })}
      </div>
    </details>
  );
}
