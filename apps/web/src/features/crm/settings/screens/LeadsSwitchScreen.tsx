"use client";

// CRM › Setup › Leads on or off (CRM plan 5.7). Off: Leads leaves the menu, and enquiries that arrive on their own — web forms, lead
// connectors, email, WhatsApp — become a company, contact and deal straight away. Leads typed in or imported are kept as leads.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
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
      {/* Tablet and phone: the current way of working and the switch. */}
      <div className="flex max-w-3xl flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm lg:hidden">
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

      {/* Desktop: the two ways of working side by side; the one in use is marked, the other has the switch. */}
      <div className="hidden flex-col gap-3 lg:flex">
        {toggle.isError && <Notice>{toggle.error instanceof Error ? toggle.error.message : "The setting could not be changed."}</Notice>}
        <div className="grid grid-cols-2 gap-4">
          {WAYS.map((way) => {
            const current = way.leads === on;
            return (
              <section key={way.title} aria-label={way.title}
                className={`flex flex-col gap-4 rounded-[var(--radius-card)] border bg-surface p-5 text-sm ${current ? "border-brand ring-1 ring-brand" : "border-border"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold text-text">{way.title}</h2>
                    <p className="text-text-secondary">{way.fits}</p>
                  </div>
                  {current && <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">In use</span>}
                </div>
                <ol className="flex flex-wrap items-center gap-2" aria-label="How an enquiry moves">
                  {way.flow.map((step, index) => (
                    <li key={step} className="flex items-center gap-2">
                      {index > 0 && <ArrowRight className="size-3.5 text-text-muted" aria-hidden="true" />}
                      <span className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-2 py-1 text-xs font-medium text-text">{step}</span>
                    </li>
                  ))}
                </ol>
                <ul className="flex flex-col gap-1.5 text-text-secondary">
                  {way.points.map((point) => <li key={point} className="flex gap-2"><span className="text-text-muted" aria-hidden="true">•</span>{point}</li>)}
                </ul>
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  {current ? (
                    <>
                      <span className="text-text-secondary">This is how your CRM works now.</span>
                      {!on && <LinkButton variant="ghost" size="compact" href="/crm/leads?status=open">Enquiries that stayed leads</LinkButton>}
                    </>
                  ) : (
                    <Button variant="primary" isLoading={toggle.isPending} onPress={() => toggle.mutate(way.leads)}>{way.leads ? "Use leads again" : "Work without leads"}</Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const WAYS = [
  { leads: true, title: "With leads", fits: "For enquiries you check before you spend time on them.",
    flow: ["Enquiry", "Lead", "Qualify", "Company, contact and deal"],
    points: ["Every enquiry arrives as a lead in Leads.", "You qualify it, then convert it into a company, contact and deal.", "Unqualified enquiries never clutter your deals."] },
  { leads: false, title: "Without leads", fits: "For a business that sells to whoever asks.",
    flow: ["Enquiry", "Company, contact and deal"],
    points: ["Web forms, lead connectors, email and WhatsApp enquiries become a company, contact and deal straight away.", "Leads leaves the menu.",
      "One that cannot be converted (no way to reach the person) stays a lead."] },
];
