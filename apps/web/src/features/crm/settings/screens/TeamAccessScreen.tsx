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
  const members = query.data.members;
  const countAt = (key: string) => members.filter((member) => !member.isOwner && member.level === key).length;
  return (
    <div className="flex w-full flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Team access" description="Each person's CRM level, in one place. Their other roles — Sales, Accounting and so on — stay as they are." />
      {change.isError && <Notice>{change.error instanceof Error ? change.error.message : "The access could not be changed."}</Notice>}
      {/* As on Setup: what the levels mean on the left, the people on the right; stacked below a laptop. */}
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <section aria-labelledby="crm-levels" className="flex flex-col gap-3">
          <h2 id="crm-levels" className="text-base font-semibold text-text">CRM levels</h2>
          <dl className="grid text-sm max-sm:divide-y max-sm:divide-border max-sm:rounded-[var(--radius-card)] max-sm:border max-sm:border-border max-sm:bg-surface sm:grid-cols-3 sm:gap-3 lg:grid-cols-1">
            {levels.filter((level) => level.key !== "none").map((level) => (
              <div key={level.key} className="flex flex-col gap-0.5 max-sm:px-3 max-sm:py-2.5 sm:max-lg:rounded-[var(--radius-card)] sm:max-lg:border sm:max-lg:border-border sm:max-lg:bg-surface sm:max-lg:p-3">
                <dt className="flex items-baseline justify-between gap-2 font-medium text-text">
                  {level.label}
                  <span className="text-xs font-normal text-text-muted">{countAt(level.key)} {countAt(level.key) === 1 ? "person" : "people"}</span>
                </dt>
                <dd className="text-text-secondary">{level.description}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-label="People" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted px-4 py-2 text-xs font-medium text-text-secondary">
            <span>Person</span>
            <span className="w-56 max-sm:hidden">CRM level</span>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {members.map((member) => (
              <li key={member.userId} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand" aria-hidden="true">
                    {member.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-text">{member.name}</span>
                    <span className="truncate text-xs text-text-muted">{member.email}{member.otherRoles.length ? ` · also ${member.otherRoles.join(", ")}` : ""}</span>
                  </div>
                </div>
                {member.isOwner ? (
                  <span className="flex h-[var(--control-height-compact)] items-center gap-2 text-text-secondary max-sm:pl-11 sm:w-56">
                    <Badge tone="brand">Owner</Badge>Full access
                  </span>
                ) : (
                  <div className="max-sm:pl-11 sm:w-56">
                    <Select aria-label={`CRM level of ${member.name}`} size="compact" selectedKey={member.level} isDisabled={change.isPending}
                      onSelectionChange={(next) => String(next) !== member.level && change.mutate({ userId: member.userId, level: String(next) })}
                      options={levels.map((level) => ({ value: level.key, label: level.label }))} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
