"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { PageHeader, PermissionState } from "@vercentlabs/design-system";

import { getModuleNavigation } from "@/shell/navigation/module-navigation-registry";
import {
  workspaceChildren,
  type NavViewer,
} from "@/shell/navigation/navigation-resolution";
import type { WorkspaceGroup } from "@/shell/navigation/navigation-types";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const SETUP_WORKSPACE = "crm-setup";

// CRM Setup: every CRM configuration destination, grouped by category, in
// the MAIN CONTENT area — never a third sidebar. Cards come from the
// navigation registry's metadata (module-navigation-registry.ts), so no
// settings screen is mounted here, every card opens a real route, and only
// destinations the person may open (and categories with at least one) are
// shown. Each destination keeps enforcing its own permission server-side.
export function CrmSetupScreen({ section }: { section: string | null }) {
  const workspace = useWorkspaceContext();
  const crm = getModuleNavigation("crm");
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

  const selected = groups.find((entry) => entry.group.id === section);

  if (selected) {
    const Icon = selected.group.icon;
    return (
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href="/crm/settings"
            className="inline-flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            All of CRM Setup
          </Link>
          <PageHeader
            title={selected.group.label}
            description={selected.group.description}
          />
        </div>
        <ul
          aria-label={`${selected.group.label} settings`}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {selected.items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.route}
                className="group flex h-full items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
              >
                <Icon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-text-secondary"
                />
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
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="CRM Setup"
        description="Configure your sales process, teams, data, integrations and controls."
      />
      <ul
        aria-label="CRM Setup categories"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {groups.map(({ group, items }) => (
          <li key={group.id}>
            <CategoryCard group={group} count={items.length} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoryCard({
  group,
  count,
}: {
  group: WorkspaceGroup;
  count: number;
}) {
  const Icon = group.icon;
  return (
    <Link
      href={`/crm/settings?section=${group.id}`}
      className="group flex h-full items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-brand-soft text-brand">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-semibold text-text">{group.label}</span>
        <span className="text-sm text-text-secondary">{group.description}</span>
        <span className="text-xs text-text-secondary">
          {count === 1 ? "1 setting" : `${count} settings`}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-text-muted group-hover:text-text"
      />
    </Link>
  );
}
