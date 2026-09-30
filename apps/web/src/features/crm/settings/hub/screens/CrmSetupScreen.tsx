"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader, PermissionState } from "@vercentlabs/design-system";

import { getModuleNavigation } from "@/shell/navigation/module-navigation-registry";
import {
  workspaceChildren,
  type NavViewer,
} from "@/shell/navigation/navigation-resolution";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const SETUP_WORKSPACE = "crm-setup";

// CRM Setup: every CRM configuration page on one screen, grouped under its
// category heading, in the MAIN CONTENT area — never a third sidebar. Each
// setting (e.g. Won / Lost Reasons) is a direct link, one click from here.
// Cards come from the navigation registry's metadata (module-navigation-
// registry.ts), so no settings screen is mounted here, every card opens a
// real route, and only settings the person may open (and categories with at
// least one) are shown. Each setting keeps enforcing its own permission
// server-side. ?section=<category> (or #<category>) scrolls to a category.
export function CrmSetupScreen({ section }: { section: string | null }) {
  const workspace = useWorkspaceContext();
  const crm = getModuleNavigation("crm");

  useEffect(() => {
    const target = section ?? window.location.hash.slice(1);
    if (target)
      document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [section]);

  if (!crm) return null;
  const viewer: NavViewer = {
    permissions: workspace.permissions,
    isOwner: workspace.roleSlugs.includes("organization_owner"),
  };
  const destinations = workspaceChildren(crm, SETUP_WORKSPACE, viewer);
  const groups = (crm.groups ?? [])
    .filter((group) => group.workspace === SETUP_WORKSPACE)
    .map((group) => ({
      group,
      items: destinations.filter((item) => item.group === group.id),
    }))
    .filter((entry) => entry.items.length > 0);

  if (groups.length === 0)
    return <PermissionState title="You don't have access to CRM Setup" />;

  return (
    <div className="flex flex-1 flex-col gap-8">
      <PageHeader
        title="CRM Setup"
        description="Configure your sales process, teams, data, integrations and controls."
      />
      {groups.map(({ group, items }) => {
        const Icon = group.icon;
        const headingId = `${group.id}-heading`;
        return (
          <section
            key={group.id}
            id={group.id}
            aria-labelledby={headingId}
            className="flex scroll-mt-6 flex-col gap-3"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-brand-soft text-brand">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <div className="flex flex-col">
                <h2
                  id={headingId}
                  className="text-base font-semibold text-text"
                >
                  {group.label}
                </h2>
                <p className="text-sm text-text-secondary">
                  {group.description}
                </p>
              </div>
            </div>
            <ul
              aria-label={`${group.label} settings`}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            >
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.route}
                    className="group flex h-full items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-sm font-semibold text-text">
                        {item.label}
                      </span>
                      {item.description ? (
                        <span className="text-sm text-text-secondary">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-text-muted group-hover:text-text"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
