"use client";

// CRM Reports: the two reports the MVP needs. Each counts only the records
// the signed-in user can see and has its own filters and grouping.
import { useRouter } from "next/navigation";
import { PageHeader, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";

import { LeadsByStatusReport } from "@/features/crm/leads/screens/LeadDashboardScreen";
import { OpportunitiesByStageReport } from "@/features/crm/opportunities/screens/OpportunityDashboardScreen";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// ?report=leads | opportunities selects the report (the sidebar links to each), and switching tabs keeps it in the URL.
export function CrmReportsScreen({ report }: { report: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const leads = can("crm.leads.view") || can("crm.view");
  const opportunities = can("crm.opportunities.view") || can("crm.view");
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="CRM Reports" description="Leads by status and opportunities by stage, over the records you can see." />
      <Tabs selectedKey={report === "opportunities" && opportunities ? "opportunities" : leads ? "leads" : "opportunities"}
        onSelectionChange={(key) => router.replace(`/crm/reports?report=${String(key)}`, { scroll: false })}>
        <TabList aria-label="Reports">
          {leads && <Tab id="leads">Leads by Status</Tab>}
          {opportunities && <Tab id="opportunities">Opportunities by Stage</Tab>}
        </TabList>
        {leads && <TabPanel id="leads"><div className="pt-3"><LeadsByStatusReport /></div></TabPanel>}
        {opportunities && <TabPanel id="opportunities"><div className="pt-3"><OpportunitiesByStageReport /></div></TabPanel>}
      </Tabs>
    </div>
  );
}
