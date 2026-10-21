"use client";

// Sales › Setup › Team Access (Sales audit): each person's Sales level — Salesperson, Billing, Dispatch or Sales manager — on one screen.
// Other roles a person has (CRM, Accounting…) stay as they are. Needs the permission to assign roles.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, ErrorState, PageHeader, PermissionState, Select } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { request } from "@/features/sales/shared/http";

type Level = { key: string; label: string; description: string; available: boolean };
type Member = { userId: string; name: string; email: string; level: string; isOwner: boolean; otherRoles: string[] };

export function SalesTeamAccessScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canAssign = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("roles.assign");
  const key = scopedQueryKey(workspace, "sales", "access-levels");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ levels: Level[]; members: Member[] }>("/access-levels"), enabled: canAssign });
  const change = useMutation({
    mutationFn: (input: { userId: string; level: string }) => request<{ member: Member }>("/access-levels", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  if (!canAssign) return <PermissionState title="You can't change people's access" description="Ask an administrator for the permission to assign roles." />;
  if (query.isLoading) return <LoadingState label="Loading the team" rows={5} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load the team" action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const levels = query.data.levels.filter((level) => level.available);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Team access" description="Each person's Sales level, in one place. Their other roles (CRM, Accounting and so on) stay as they are." />
      <dl className="grid max-w-5xl gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {levels.filter((level) => level.key !== "none").map((level) => (
          <div key={level.key} className="rounded-[var(--radius-control)] border border-border bg-surface p-3"><dt className="font-medium">{level.label}</dt><dd className="text-text-secondary">{level.description}</dd></div>
        ))}
      </dl>
      {change.isError && <Notice>{change.error instanceof Error ? change.error.message : "The access could not be changed."}</Notice>}
      <ul className="flex max-w-5xl flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {query.data.members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{member.name}</span>
              <span className="text-xs text-text-muted">{member.email}{member.otherRoles.length ? ` · also ${member.otherRoles.join(", ")}` : ""}</span>
            </div>
            {member.isOwner ? <Badge tone="brand">Owner: full access</Badge> : (
              <div className="w-56">
                <Select aria-label={`Sales level of ${member.name}`} size="compact" selectedKey={member.level} isDisabled={change.isPending}
                  onSelectionChange={(next) => String(next) !== member.level && change.mutate({ userId: member.userId, level: String(next) })}
                  options={levels.map((level) => ({ value: level.key, label: level.label }))} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
