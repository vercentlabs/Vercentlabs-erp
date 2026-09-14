"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon, Lock } from "lucide-react";
import { Drawer, IconButton } from "@vercentlabs/design-system";
import type { ModuleAccess } from "@vercentlabs/api";

import {
  MODULE_NAV_ENTRIES,
  GLOBAL_NAV_TOP,
  GLOBAL_NAV_BOTTOM,
  UTILITY_NAV,
} from "@/shell/navigation/moduleNavigationRegistry";

const MODULE_ACCESS_REASON_LABEL: Record<string, string> = {
  not_released: "Not yet available",
  disabled: "Not enabled for your organisation",
  not_entitled: "Not included in your plan",
  not_permitted: "You don't have permission for this module",
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DrawerRow({
  href,
  label,
  icon,
  disabled,
  disabledReason,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  active: boolean;
  onNavigate: () => void;
}) {
  if (disabled) {
    return (
      <span className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm text-text-muted opacity-60">
        {icon}
        <span className="flex-1">{label}</span>
        <Lock aria-hidden="true" className="size-3.5" />
        <span className="sr-only">{disabledReason}</span>
      </span>
    );
  }
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-brand-soft text-brand font-medium"
          : "text-text hover:bg-surface-muted",
      ].join(" ")}
    >
      {icon}
      {label}
    </Link>
  );
}

// Phone/tablet nav surface (<1024px) — the primary icon rail is hidden at
// this breakpoint (PrimarySidebar has `hidden lg:flex`) in favor of this
// top bar + full-label drawer, per Phase 2's explicit "never just squeeze
// both sidebars into 390px" instruction.
export function MobileNav({
  organizationName,
  accessibleModules,
}: {
  organizationName: string | null;
  accessibleModules: ModuleAccess[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const accessByModuleKey = new Map(
    accessibleModules.map((access) => [access.moduleId, access]),
  );

  return (
    <div className="flex lg:hidden">
      <header className="flex h-14 w-full shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        <IconButton
          aria-label="Open navigation"
          variant="ghost"
          onPress={() => setOpen(true)}
        >
          <MenuIcon aria-hidden="true" className="size-5" />
        </IconButton>
        <span className="truncate text-sm font-semibold text-text">
          {organizationName || "Vercentlabs ERP"}
        </span>
      </header>

      <Drawer
        isOpen={open}
        onOpenChange={setOpen}
        title="Navigation"
        side="left"
        size="sm"
      >
        {({ close }) => (
          <nav aria-label="Primary" className="flex flex-col gap-1">
            {GLOBAL_NAV_TOP.map((entry) => (
              <DrawerRow
                key={entry.key}
                href={entry.href}
                label={entry.label}
                icon={<entry.icon aria-hidden="true" className="size-4" />}
                active={isActive(pathname, entry.href)}
                onNavigate={close}
              />
            ))}

            <div aria-hidden="true" className="my-2 h-px bg-border" />

            {MODULE_NAV_ENTRIES.map((entry) => {
              const access = accessByModuleKey.get(entry.moduleKey);
              const accessible = access?.accessible ?? false;
              return (
                <DrawerRow
                  key={entry.moduleKey}
                  href={entry.href}
                  label={entry.label}
                  icon={<entry.icon aria-hidden="true" className="size-4" />}
                  disabled={!accessible}
                  disabledReason={
                    access?.reason
                      ? MODULE_ACCESS_REASON_LABEL[access.reason]
                      : undefined
                  }
                  active={isActive(pathname, entry.href)}
                  onNavigate={close}
                />
              );
            })}

            <div aria-hidden="true" className="my-2 h-px bg-border" />

            {GLOBAL_NAV_BOTTOM.map((entry) => (
              <DrawerRow
                key={entry.key}
                href={entry.href}
                label={entry.label}
                icon={<entry.icon aria-hidden="true" className="size-4" />}
                active={isActive(pathname, entry.href)}
                onNavigate={close}
              />
            ))}

            <div aria-hidden="true" className="my-2 h-px bg-border" />

            {UTILITY_NAV.map((entry) => (
              <DrawerRow
                key={entry.key}
                href={entry.href}
                label={entry.label}
                icon={<entry.icon aria-hidden="true" className="size-4" />}
                disabled={entry.availability === "planned"}
                disabledReason={
                  entry.availability === "planned" ? "Coming soon" : undefined
                }
                active={isActive(pathname, entry.href)}
                onNavigate={close}
              />
            ))}
          </nav>
        )}
      </Drawer>
    </div>
  );
}
