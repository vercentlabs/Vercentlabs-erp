"use client";

// Settings › People and access: one tab row across its three pages — Users · Invitations · Roles — drawn like the other tab bars
// (RouteTabs), each tab a link to its page and shown only to someone who may open it. Invitations carries how many are still pending
// (the same cached list the Invitations page reads, so it is fetched once).
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { listInvitations } from "@/features/settings/invitations/api/invitations-api";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export type PeopleAccessTab = "users" | "invitations" | "roles";
export const PEOPLE_ACCESS_TITLE = "People and access";
export const INVITATIONS_QUERY_KEY = ["settings", "invitations"];

export function PeopleAccessTabs({ current }: { current: PeopleAccessTab }) {
  const workspace = useWorkspaceContext();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const canInvite = can("users.manage");
  const invitations = useQuery({ queryKey: INVITATIONS_QUERY_KEY, queryFn: listInvitations, enabled: canInvite, staleTime: 30_000 });
  const pending = invitations.data?.invitations.filter((invitation) => invitation.status === "pending").length ?? 0;

  const tabs = [
    { id: "users" as const, label: "Users", href: "/settings/users", show: can("users.view") },
    { id: "invitations" as const, label: "Invitations", href: "/settings/invitations", show: canInvite, count: pending },
    { id: "roles" as const, label: "Roles", href: "/settings/roles", show: can("roles.view") },
  ].filter((tab) => tab.show || tab.id === current);
  if (tabs.length < 2) return null;

  return (
    <nav aria-label={PEOPLE_ACCESS_TITLE} className="-mt-2">
      <ul className="flex max-w-full gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const selected = tab.id === current;
          return (
            <li key={tab.id} className="shrink-0">
              <Link href={tab.href} aria-current={selected ? "page" : undefined}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-[var(--motion-fast)] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
                  selected ? "border-brand text-text" : "border-transparent text-text-secondary hover:border-border-strong hover:text-text"}`}>
                {tab.label}
                {tab.count ? (
                  <span className="min-w-5 rounded-full bg-warning-soft px-1.5 text-center text-[11px] leading-[18px] font-semibold text-warning tabular-nums" aria-label={`${tab.count} pending`}>
                    {tab.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
