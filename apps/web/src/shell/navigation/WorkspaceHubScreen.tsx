"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader, PermissionState } from "@vercentlabs/design-system";

import { getModuleNavigation } from "@/shell/navigation/module-navigation-registry";
import { workspaceChildren, type NavViewer } from "@/shell/navigation/navigation-resolution";
import type { SecondaryNavItem } from "@/shell/navigation/navigation-types";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// A configuration hub (e.g. CRM › Lead Setup): every destination registered under the workspace, as cards in the main content — never a
// third sidebar. Cards come from the navigation registry (parent = the workspace), grouped under the module's groups for that workspace when
// it has any; only destinations the person may open are shown, and each keeps enforcing its own permission server-side.
// ?section=<group> (or #<group>) scrolls to a group.
export function WorkspaceHubScreen({ moduleKey, workspace, title, description, section = null }: {
  moduleKey: string; workspace: string; title: string; description: string; section?: string | null;
}) {
  const context = useWorkspaceContext();
  const navigation = getModuleNavigation(moduleKey);

  useEffect(() => {
    const target = section ?? window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [section]);

  if (!navigation) return null;
  const viewer: NavViewer = { permissions: context.permissions, isOwner: context.roleSlugs.includes("organization_owner") };
  const destinations = workspaceChildren(navigation, workspace, viewer);
  const declared = (navigation.groups ?? []).filter((group) => group.workspace === workspace);
  const groups = declared.length
    ? declared.map((group) => ({ id: group.id, label: group.label, description: group.description, icon: group.icon,
      items: destinations.filter((item) => item.group === group.id) })).filter((entry) => entry.items.length > 0)
    : destinations.length ? [{ id: workspace, label: null, description: null, icon: null, items: destinations }] : [];

  if (!groups.length) return <PermissionState title={`You do not have access to ${title}`} />;

  return (
    <div className="flex flex-1 flex-col gap-8">
      <PageHeader title={title} description={description} />
      {groups.map(({ id, label, description: about, icon: Icon, items }) => (
        <section key={id} id={id} aria-labelledby={label ? `${id}-heading` : undefined} aria-label={label ? undefined : title} className="flex scroll-mt-6 flex-col gap-3">
          {label && (
            <div className="flex items-start gap-3">
              {Icon && <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-brand-soft text-brand"><Icon aria-hidden="true" className="size-4" /></span>}
              <div className="flex flex-col">
                <h2 id={`${id}-heading`} className="text-base font-semibold text-text">{label}</h2>
                {about && <p className="text-sm text-text-secondary">{about}</p>}
              </div>
            </div>
          )}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item: SecondaryNavItem) => (
              <li key={item.id}>
                <Link href={item.route}
                  className="group flex h-full items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none">
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-sm font-semibold text-text">{item.label}</span>
                    {item.description ? <span className="text-sm text-text-secondary">{item.description}</span> : null}
                  </span>
                  <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted group-hover:text-text" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
