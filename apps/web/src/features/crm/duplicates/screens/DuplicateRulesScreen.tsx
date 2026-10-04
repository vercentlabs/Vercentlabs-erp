"use client";

// Duplicate Detection Rules: what the system compares, and whether a match
// is strong (stops the save) or possible (a warning). Shown in plain words;
// the scoring behind it is not something an administrator has to tune.
import { useQuery } from "@tanstack/react-query";
import { Badge, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { duplicatesErrorMessage, getDuplicateRules, type DuplicateRule } from "../api/duplicates-api";

function RuleTable({ title, rules }: { title: string; rules: DuplicateRule[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {rules.map((rule) => (
          <li key={rule.signal} className="flex items-center justify-between gap-3 py-2">
            <span>{rule.label}</span>
            <Badge tone={rule.strength === "strong" ? "warning" : "neutral"}>{rule.strength === "strong" ? "Strong" : "Possible"}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DuplicateRulesScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "duplicate-rules"), queryFn: getDuplicateRules, enabled: canManage });
  if (!canManage) return <PermissionState title="You cannot open CRM settings" description="Ask a CRM administrator for access." />;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Duplicate Detection Rules" description="Checked whenever a lead, contact or account is created, imported or converted. Matches found later are reviewed under Data Quality." />
      {query.isLoading ? <LoadingState label="Loading rules" rows={4} />
        : query.isError || !query.data ? <p role="alert" className="text-sm text-danger">{duplicatesErrorMessage(query.error, "The rules could not be loaded.")}</p>
        : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <RuleTable title={query.data.people.label} rules={query.data.people.rules} />
              <RuleTable title={query.data.companies.label} rules={query.data.companies.rules} />
            </div>
            <section className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface-muted p-4 text-sm">
              <p><span className="font-medium">Strong match.</span> {query.data.behaviour.strong}</p>
              <p><span className="font-medium">Possible match.</span> {query.data.behaviour.possible}</p>
              <p className="text-text-secondary">These rules are built in. Who may create a record despite a strong match is set by the “Override duplicates” permission on each role.</p>
            </section>
          </>
        )}
    </div>
  );
}
