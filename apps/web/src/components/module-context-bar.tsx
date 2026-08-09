"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import { matchesPath } from "@/lib/navigation/match-path";

type ModuleLink = {
  href: string;
  label: string;
  exact?: boolean;
  activePrefixes?: string[];
};

type ModuleGroup = {
  label: string;
  icon: AppIconName;
  items: ModuleLink[];
};

const quickActions: Record<string, { href: string; label: string }> = {
  CRM: { href: "/crm/leads?create=1", label: "Create lead" },
  Sales: { href: "/sales/quotations/new", label: "New quotation" },
  Procurement: {
    href: "/procurement/requisitions/new",
    label: "New requisition",
  },
  Accounting: { href: "/accounting/journals/new", label: "New journal" },
};

const matches = matchesPath;

export default function ModuleContextBar({
  modules,
}: {
  modules: ModuleGroup[];
}) {
  const pathname = usePathname();
  const activeModule = modules.find((group) => {
    const root = group.items[0]?.href;
    return Boolean(
      root && (pathname === root || pathname.startsWith(`${root}/`)),
    );
  });

  if (!activeModule) return null;

  const activeItem = [...activeModule.items]
    .sort((left, right) => right.href.length - left.href.length)
    .find((item) => matches(pathname, item));
  const quickAction = quickActions[activeModule.label];
  const moduleKey = activeModule.label.toLowerCase().replaceAll(" ", "-");

  return (
    <section
      className={`module-context-bar module-context-${moduleKey}`}
      aria-label={`${activeModule.label} module navigation`}
    >
      <div className="module-context-identity">
        <span className="module-context-icon" aria-hidden="true">
          <AppIcon name={activeModule.icon} size={18} />
        </span>
        <span>
          <small>{activeModule.label}</small>
          <strong>{activeItem?.label || "Overview"}</strong>
        </span>
      </div>

      <nav
        className="module-context-tabs"
        aria-label={`${activeModule.label} sections`}
      >
        {activeModule.items.map((item) => {
          const current = matches(pathname, item);
          return (
            <Link
              aria-current={current ? "page" : undefined}
              className={current ? "active" : undefined}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {quickAction ? (
        <Link className="module-context-action" href={quickAction.href}>
          <span aria-hidden="true">＋</span>
          {quickAction.label}
        </Link>
      ) : null}
    </section>
  );
}
