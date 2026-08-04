"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import NavigationLink from "@/components/navigation-link";

export type NavigationSectionItem = {
  href: string;
  label: string;
  icon: AppIconName;
  badge?: number;
  exact?: boolean;
  group?: string;
  activePrefixes?: string[];
};

function matchesPath(pathname: string, item: NavigationSectionItem) {
  if (item.exact && pathname === item.href) return true;
  if (
    !item.exact &&
    (pathname === item.href || pathname.startsWith(`${item.href}/`))
  ) {
    return true;
  }
  return Boolean(
    item.activePrefixes?.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ),
  );
}

export default function NavigationSection({
  label,
  icon,
  items,
  mobile = false,
}: {
  label: string;
  icon: AppIconName;
  items: NavigationSectionItem[];
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const active = items.some((item) => matchesPath(pathname, item));

  return (
    <details
      className={`nav-section${active ? " active" : ""}${mobile ? " mobile" : ""}`}
      open={active}
    >
      <summary>
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
