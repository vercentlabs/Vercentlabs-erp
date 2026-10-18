"use client";

// CRM › Setup › Team access (CRM plan 5.7): each member's CRM level — Salesperson, Sales manager or CRM administrator — on one screen.
// Other roles a member has (Sales, Accounting…) stay as they are. Needs the permission to assign roles.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, ErrorState, PageHeader, PermissionState, Select } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class AccessError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(AccessError, "body");
type Level = { key: string; label: string; description: string; available: boolean };
type Member = { userId: string; name: string; email: string; level: string; isOwner: boolean; otherRoles: string[] };

export function TeamAccessScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canAssign = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("roles.assign");
  const key = scopedQueryKey(workspace, "crm", "access-levels");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ levels: Level[]; members: Member[] }>("/api/crm/access-levels"), enabled: canAssign });
  const change = useMutation({
    mutationFn: (input: { userId: string; level: string }) => request<{ member: Member }>("/api/crm/access-levels", { method: "PUT", json: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  if (!canAssign) return <PermissionState title="You can't change people's access" description="Ask an administrator for the permission to assign roles." />;
  if (query.isLoading) return <LoadingState label="Loading the team" rows={5} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load the team" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const levels = query.data.levels.filter((level) => level.available);
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Team access" description="Each person's CRM level, in one place. Their other roles — Sales, Accounting and so on — stay as they are." />
      <dl className="grid max-w-4xl gap-2 text-sm sm:grid-cols-3">
        {levels.filter((level) => level.key !== "none").map((level) => (
          <div key={level.key} className="rounded-[var(--radius-control)] border border-border bg-surface p-3"><dt className="font-medium">{level.label}</dt><dd className="text-text-secondary">{level.description}</dd></div>
        ))}
      </dl>
      {change.isError && <Notice>{change.error instanceof Error ? change.error.message : "The access could not be changed."}</Notice>}
      <ul className="flex max-w-4xl flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {query.data.members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{member.name}</span>
              <span className="text-xs text-text-muted">{member.email}{member.otherRoles.length ? ` · also ${member.otherRoles.join(", ")}` : ""}</span>
            </div>
            {member.isOwner ? <Badge tone="brand">Owner: full access</Badge> : (
              <div className="w-56">
                <Select aria-label={`CRM level of ${member.name}`} size="compact" selectedKey={member.level} isDisabled={change.isPending}
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
