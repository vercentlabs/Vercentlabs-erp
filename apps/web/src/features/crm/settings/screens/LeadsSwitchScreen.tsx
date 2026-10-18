"use client";

// CRM › Setup › Leads on or off (CRM plan 5.7). Off: Leads leaves the menu, and enquiries that arrive on their own — web forms, lead
// connectors, email, WhatsApp — become a company, contact and deal straight away. Leads typed in or imported are kept as leads.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, LinkButton, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class SwitchError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(SwitchError, "body");
export const getLeadsSwitch = () => request<{ leadsEnabled: boolean }>("/api/crm/leads-switch").then((result) => result.leadsEnabled);

export function LeadsSwitchScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "leads-switch");
  const query = useQuery({ queryKey: key, queryFn: getLeadsSwitch, enabled: canManage });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => request<{ leadsEnabled: boolean }>("/api/crm/leads-switch", { method: "PUT", json: { enabled } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  if (!canManage) return <PermissionState title="You can't change CRM settings" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading" rows={2} />;
  if (query.isError) return <ErrorState title="Could not load the setting" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const on = query.data !== false;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Work with leads" description="Leads are enquiries you qualify before they become deals. A business that sells to whoever asks can work without them." />
      <div className="flex max-w-3xl flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
        <p className="font-medium">{on ? "Leads are on." : "Leads are off."}</p>
        <p className="text-text-secondary">
          {on ? "Enquiries arrive as leads; you qualify them, then convert them into a company, contact and deal."
            : "Enquiries that arrive on their own — web forms, lead connectors, email, WhatsApp — become a company, contact and deal straight away, and Leads is not in the menu. One that cannot be converted (no way to reach the person) stays a lead."}
        </p>
        {toggle.isError && <Notice>{toggle.error instanceof Error ? toggle.error.message : "The setting could not be changed."}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button variant={on ? "secondary" : "primary"} isLoading={toggle.isPending} onPress={() => toggle.mutate(!on)}>{on ? "Work without leads" : "Use leads again"}</Button>
          {!on && <LinkButton variant="ghost" href="/crm/leads?status=open">Enquiries that stayed leads</LinkButton>}
        </div>
      </div>
    </div>
  );
}
